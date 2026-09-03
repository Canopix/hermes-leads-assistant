#!/bin/bash
#
# Hermes Leads Assistant — VPS bootstrap script.
#
# Configures a fresh Ubuntu/Debian VPS to run the portal + Hermes profiles
# behind Nginx with HTTPS. Safe to re-run.
#
# Required env (read at the top):
#   LEADAI_REPO_URL   git URL of the hermes-leads-assistant repo
#   LEADAI_DOMAIN     public hostname (e.g. leads.example.com)
#   LEADAI_ADMIN_EMAIL  email for certbot + Let's Encrypt notifications
#
# Optional env:
#   HERMES_INSTALL_URL  installer URL (defaults to the official hermes install script)
#   KAPSO_INGRESS       "on" | "off" — expose Kapso webhook ports via Nginx
#                       (default: on)
#   BACKUP_TARGET       rsync/S3 destination; if unset, backups go to
#                       /var/backups/lead-ai only
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  die "Run as root (sudo)."
fi

DOMAIN="${LEADAI_DOMAIN:-$1}"
if [[ -z "$DOMAIN" ]]; then
  die "Set LEADAI_DOMAIN (or pass it as \$1). Example: sudo LEADAI_DOMAIN=leads.example.com LEADAI_REPO_URL=git@github.com:you/hermes-leads-assistant.git ./deploy.sh"
fi

: "${LEADAI_REPO_URL:?Set LEADAI_REPO_URL to the git clone URL of the hermes-leads-assistant repo}"
: "${LEADAI_ADMIN_EMAIL:?Set LEADAI_ADMIN_EMAIL for TLS certificate notifications}"

HERMES_INSTALL_URL="${HERMES_INSTALL_URL:-https://raw.githubusercontent.com/NousResearch/hermes-agent/main/install.sh}"
KAPSO_INGRESS="${KAPSO_INGRESS:-on}"
APP_DIR=/opt/hermes-leads-assistant
APP_USER=leadai
HERMES_USER=leadai  # same user runs the portal and Hermes gateways

info "Bootstrap target: $DOMAIN"
info "Repo URL: $LEADAI_REPO_URL"
info "Admin email: $LEADAI_ADMIN_EMAIL"
info "Kapso ingress: $KAPSO_INGRESS"

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------

info "Updating system packages…"
apt-get update -y
apt-get upgrade -y

info "Installing base packages…"
apt-get install -y curl wget git unzip software-properties-common \
  ca-certificates gnupg logrotate rsync

info "Installing Node.js 20 (LTS)…"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v2[0-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
info "Node version: $(node -v)"

info "Installing pnpm…"
if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@9
fi

info "Installing Python…"
apt-get install -y python3 python3-pip python3-venv

info "Installing Nginx + Certbot…"
apt-get install -y nginx certbot python3-certbot-nginx

# ---------------------------------------------------------------------------
# 2. Hermes Agent (explicit install, no TODO)
# ---------------------------------------------------------------------------

info "Installing Hermes Agent…"
HERMES_HOME="${HERMES_HOME:-/home/$HERMES_USER/.hermes}"
if [[ ! -d "$HERMES_HOME" ]]; then
  # The official installer is idempotent and creates the user/local dirs.
  # We run it as the app user so profiles live under their home.
  install -d -o "$HERMES_USER" -g "$HERMES_USER" "$(getent passwd "$HERMES_USER" | cut -d: -f6)"
  sudo -u "$HERMES_USER" env HERMES_INSTALL_URL="$HERMES_INSTALL_URL" bash -c '
    set -e
    if ! command -v hermes >/dev/null 2>&1; then
      curl -fsSL "$HERMES_INSTALL_URL" | bash
    fi
  ' || warn "Hermes installer exited non-zero. Install Hermes manually before provisioning tenants."
else
  info "Hermes home already exists at $HERMES_HOME — skipping install."
fi

# ---------------------------------------------------------------------------
# 3. Application user + repo
# ---------------------------------------------------------------------------

info "Ensuring app user '$APP_USER'…"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash "$APP_USER"
fi

info "Cloning/updating repo at $APP_DIR…"
if [[ ! -d "$APP_DIR/.git" ]]; then
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone "$LEADAI_REPO_URL" "$APP_DIR"
fi

info "Installing deps and building (as $APP_USER)…"
sudo -u "$APP_USER" bash -c "
  set -e
  cd '$APP_DIR'
  pnpm install --frozen-lockfile
  pnpm run build
"

info "Chowning app tree…"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------------------
# 4. Secrets + env file
# ---------------------------------------------------------------------------

ENV_FILE="$APP_DIR/apps/portal/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Generating $ENV_FILE with fresh secrets…"
  SECRET=$(openssl rand -base64 32)
  cat > "$ENV_FILE" <<EOF
# Generated by deploy.sh on $(date -u +%FT%TZ). NEVER commit.
BETTER_AUTH_SECRET=$SECRET
BETTER_AUTH_URL=https://$DOMAIN
HERMES_PROFILES_DIR=$HERMES_HOME/profiles
PORTAL_AUTH_DB=$HERMES_HOME/portal/auth.sqlite

# Observability — uncomment SENTRY_DSN after creating a project at sentry.io
LOG_LEVEL=info
# SENTRY_DSN=
# SENTRY_TRACES_SAMPLE_RATE=0.1
EOF
  chmod 600 "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  info "Wrote BETTER_AUTH_URL=https://$DOMAIN"
else
  info "$ENV_FILE already exists — leaving as-is."
fi

# ---------------------------------------------------------------------------
# 5. systemd unit for the portal (Next.js standalone server.js)
# ---------------------------------------------------------------------------

info "Writing leadai-portal.service…"
cat > /etc/systemd/system/leadai-portal.service <<EOF
[Unit]
Description=Lead AI Portal (Next.js)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/apps/portal
EnvironmentFile=$APP_DIR/apps/portal/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node $APP_DIR/apps/portal/.next/standalone/apps/portal/server.js
Restart=always
RestartSec=10

# Hardening
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$APP_DIR $HERMES_HOME
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

# Copy static assets next to the standalone server (Next requires this).
info "Syncing .next/static into standalone…"
rsync -a --delete \
  "$APP_DIR/apps/portal/.next/static/" \
  "$APP_DIR/apps/portal/.next/standalone/apps/portal/.next/static/" || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR/apps/portal/.next/standalone"

# NOTE: the old leadai-cli.service unit ran `python3 leadai.py monitor watch`,
# a subcommand that does not exist. We deliberately do not write that unit.
# Per-tenant gateway health is exposed by the portal's /admin/health page,
# and an external watchdog (Uptime Kuma / Healthchecks.io) should probe
# /api/health. See README "Operación > Monitoreo" for the recommendation.

# ---------------------------------------------------------------------------
# 6. Nginx — bootstrap HTTP first (so certbot can do the HTTP-01 challenge),
#    then run certbot, then write the full HTTPS config.
# ---------------------------------------------------------------------------

info "Writing Nginx HTTP-only bootstrap config (for certbot)…"
cat > /etc/nginx/sites-available/leadai <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # ACME challenge passthrough + temporary redirect to HTTPS once issued.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
ln -sf /etc/nginx/sites-available/leadai /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

info "Reloading Nginx with HTTP-only config…"
nginx -t
systemctl reload nginx

if [[ "$DOMAIN" != "localhost" ]]; then
  info "Issuing Let's Encrypt certificate for $DOMAIN…"
  if certbot --nginx -d "$DOMAIN" \
      --non-interactive --agree-tos \
      --email "$LEADAI_ADMIN_EMAIL" \
      --redirect; then
    info "Certbot issued + installed the cert."
  else
    warn "Certbot failed. The portal is reachable over HTTP only for now."
    warn "Run 'certbot --nginx -d $DOMAIN' manually once DNS is correct."
  fi
else
  warn "Skipping certbot for localhost."
fi

# Now write the final, complete Nginx config (HTTP→HTTPS + reverse proxy).
info "Writing final Nginx config…"
cat > /etc/nginx/sites-available/leadai <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Cap request body size — protects against large payloads on PATCH/PUT.
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}
EOF

# Optional: Kapso webhook ports (8648-8697) reverse-proxied over HTTPS.
if [[ "$KAPSO_INGRESS" == "on" ]]; then
  info "Enabling Kapso webhook ingress (path /kapso/<slug>/<port>)…"
  warn "Per-port hostnames require a wildcard cert. For now, only the path-based proxy is wired."
fi

info "Reloading Nginx with final config…"
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------------------
# 7. Firewall
# ---------------------------------------------------------------------------

info "Configuring ufw…"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

# ---------------------------------------------------------------------------
# 8. Enable + start services
# ---------------------------------------------------------------------------

info "Enabling + starting leadai-portal…"
systemctl daemon-reload
systemctl enable leadai-portal
systemctl restart leadai-portal

# ---------------------------------------------------------------------------
# 9. Log rotation for Hermes profile logs
# ---------------------------------------------------------------------------

info "Installing logrotate config for Hermes profiles…"
cat > /etc/logrotate.d/lead-ai-hermes <<'EOF'
/var/home/leadai/.hermes/profiles/*-leads/logs/*.log
/home/leadai/.hermes/profiles/*-leads/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

# ---------------------------------------------------------------------------
# 10. Daily backups (leads.db + knowledge/) — local + optional remote
# ---------------------------------------------------------------------------

info "Installing backup script + cron…"
install -d -o root -g root -m 0755 /usr/local/sbin /var/backups/lead-ai
cat > /usr/local/sbin/lead-ai-backup.sh <<'EOF'
#!/bin/bash
# Daily backup of every Hermes profile's leads.db + knowledge/. Safe to re-run.
set -euo pipefail
HERMES_HOME="${HERMES_HOME:-/home/leadai/.hermes}"
BACKUP_DIR="/var/backups/lead-ai"
REMOTE="${BACKUP_TARGET:-}"
DATE="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

mkdir -p "$BACKUP_DIR"
if [[ ! -d "$HERMES_HOME/profiles" ]]; then
  echo "no profiles dir at $HERMES_HOME/profiles; nothing to back up"
  exit 0
fi

for profile_dir in "$HERMES_HOME"/profiles/*-leads; do
  [[ -d "$profile_dir" ]] || continue
  slug="$(basename "$profile_dir" | sed 's/-leads$//')"
  dest="$STAGING/$slug-$DATE.tar.gz"
  # SQLite online backup so we don't read a half-written page.
  db="$profile_dir/.lead-capture/leads.db"
  if [[ -f "$db" ]]; then
    sqlite3 "$db" ".backup '$db.snapshot'"
    mv "$db.snapshot" "$db.bak-for-tar"
  fi
  tar -czf "$dest" \
    -C "$profile_dir" \
    $( [[ -f "$db.bak-for-tar" ]] && echo ".lead-capture/leads.db.bak-for-tar" ) \
    knowledge \
    SOUL.md config.yaml 2>/dev/null || true
  rm -f "$db.bak-for-tar"
  mv "$dest" "$BACKUP_DIR/"
done

# Retain 30 days locally.
find "$BACKUP_DIR" -name '*.tar.gz' -mtime +30 -delete

# Optional remote sync.
# NOTE: do NOT use --delete here. If the local BACKUP_DIR ever becomes empty
# (e.g. profiles dir wiped by accident, this script aborted early, find -mtime
# removed everything), rsync --delete would mirror that empty state to the
# remote and destroy the only surviving backup. Use --delete-after with an
# explicit non-empty guard if true mirroring becomes a hard requirement later.
if [[ -n "$REMOTE" ]]; then
  if [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    echo "[backup] local BACKUP_DIR is empty; refusing to sync to REMOTE to avoid wiping it" >&2
    exit 1
  fi
  rsync -a "$BACKUP_DIR/" "$REMOTE/"
fi
EOF
chmod 0755 /usr/local/sbin/lead-ai-backup.sh

cat > /etc/cron.d/lead-ai-backup <<'EOF'
# Daily at 03:17 UTC — run the lead-ai backup script.
17 3 * * * root HERMES_HOME=/home/leadai/.hermes /usr/local/sbin/lead-ai-backup.sh >> /var/log/lead-ai-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/lead-ai-backup

# ---------------------------------------------------------------------------
# 11. Update script
# ---------------------------------------------------------------------------

info "Writing /opt/hermes-leads-assistant/update.sh…"
cat > "$APP_DIR/update.sh" <<'EOF'
#!/bin/bash
# Pull latest + rebuild + restart portal. Run as root or $APP_USER with sudo.
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
rsync -a --delete apps/portal/.next/static/ apps/portal/.next/standalone/apps/portal/.next/static/
sudo systemctl restart leadai-portal
EOF
chmod +x "$APP_DIR/update.sh"
chown "$APP_USER:$APP_USER" "$APP_DIR/update.sh"

# ---------------------------------------------------------------------------
# 12. Done
# ---------------------------------------------------------------------------

info "Bootstrap complete."
cat <<EOM

Portal:        https://$DOMAIN
App dir:       $APP_DIR
App user:      $APP_USER
Hermes home:   $HERMES_HOME
Backup script: /usr/local/sbin/lead-ai-backup.sh (daily cron at 03:17 UTC)
Update script: $APP_DIR/update.sh

Next steps:
  1. Provision your first tenant:
     sudo -u $APP_USER bash $APP_DIR/packages/ops/provision-client.sh \\
       --slug acme --name "Acme" --telegram-token "..."
  2. Create the first super admin:
     sudo -u $APP_USER bash -c 'cd $APP_DIR/apps/portal && pnpm exec tsx scripts/create-super-admin.ts \\
       --email you@example.com --password "..." --name "Your Name"'
  3. Sign in at https://$DOMAIN/login and add the tenant to your user from
     /admin/tenants → tenant detail → members.
  4. Configure an external uptime monitor to probe https://$DOMAIN/api/health.
EOM
