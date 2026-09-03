---
title: Backups and restore
description: Backup strategy and how to restore.
template: doc
---

# Runbook: Backups and restore

## Automatic backups (VPS)

`deploy.sh` installs a daily cron in `/etc/cron.d/lead-ai-backup` (03:17 UTC).

For each `*-leads` profile:

1. **Online backup** of `.lead-capture/leads.db` via `sqlite3 .backup`.
   - Doesn't block writers.
   - Generates a consistent snapshot.
2. `tar -czf` with:
   - `leads.db` (snapshot)
   - `knowledge/`
   - `SOUL.md`
   - `config.yaml`
3. → `/var/backups/lead-ai/{slug}-{timestamp}.tar.gz`
4. Local retention **30 days** (cron cleans old ones).
5. Optional rsync to `BACKUP_TARGET`.

### rsync safety

The rsync to `BACKUP_TARGET`:

- **No `--delete`** — never deletes remote files that don't exist locally.
- Guard that **refuses to sync if the local dir is empty** (prevents a remote wipe from a misfire where the source got emptied).

```bash
if [[ -z "$(ls -A /var/backups/lead-ai/)" ]]; then
  echo "ERROR: local backup dir empty — refusing to rsync (would wipe remote)"
  exit 1
fi
rsync -a /var/backups/lead-ai/ "$BACKUP_TARGET"
```

## What is NOT in the automatic backup

- `auth.sqlite` (portal DB) — back it up manually.
- `.lead-rag/` (embeddings — can be re-ingested).
- `.lead-documents/files/` (originals — can be requested from the client).
- `sessions/` (history — regenerates).
- `.env` (secrets — **must not** go into the backup, for security reasons).

If you need a full profile snapshot, use the [deprovision with archive](./deprovision/) flow, which does tar the whole profile.

## Manual backups

### Quick snapshot before a risky operation

```bash
# Before a schema migration or re-provision
tar -czf /tmp/acme-pre-op-$(date +%s).tar.gz \
  -C ~/.hermes/profiles acme-corp-leads/
```

### Online backup of auth.sqlite

```bash
sqlite3 ~/.hermes/portal/auth.sqlite ".backup /tmp/auth-$(date +%s).sqlite"
```

### Full backup of a tenant (everything)

```bash
# Stop the bot first for consistency
python cli/leadai.py bot stop acme-corp

tar -czf ~/backups/acme-corp-full-$(date -u +%Y%m%d).tar.gz \
  -C ~/.hermes/profiles acme-corp-leads/

python cli/leadai.py bot start acme-corp
```

`chmod 600` recommended.

## Restore

### From automatic backup (leads.db + knowledge + soul + config)

```bash
# 1. List available
ls -la /var/backups/lead-ai/ | grep acme-corp

# 2. Stop the bot
python cli/leadai.py bot stop acme-corp

# 3. Back up the current state (just in case)
mv ~/.hermes/profiles/acme-corp-leads ~/.hermes/profiles/acme-corp-leads.broken

# 4. Extract the backup
mkdir -p ~/.hermes/profiles/acme-corp-leads
tar -xzf /var/backups/lead-ai/acme-corp-20260624-031700.tar.gz \
  -C ~/.hermes/profiles/acme-corp-leads/
# Note: the backup tar is structured as {slug}-leads/... check this

# 5. Re-create .env (NOT included in the automatic backup)
# Copy from secure storage or regenerate:
cp ~/.hermes/profiles/acme-corp-leads.broken/.env ~/.hermes/profiles/acme-corp-leads/.env

# 6. Restart
python cli/leadai.py bot start acme-corp

# 7. Verify
python cli/leadai.py bot status acme-corp
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-capture/leads.db "SELECT COUNT(*) FROM leads;"

# 8. Cleanup
rm -rf ~/.hermes/profiles/acme-corp-leads.broken
```

### From the encrypted archive (deprovision)

See the [deprovision / restore runbook](./deprovision/).

### Restore of auth.sqlite (portal DB)

```bash
# STOP the portal first
sudo systemctl stop leadai-portal

# Back up the current one
cp ~/.hermes/portal/auth.sqlite ~/.hermes/portal/auth.sqlite.broken

# Restore
sqlite3 ~/.hermes/portal/auth.sqlite.broken ".backup ~/.hermes/portal/auth.sqlite"
# or directly:
cp /tmp/auth-backup.sqlite ~/.hermes/portal/auth.sqlite

sudo systemctl start leadai-portal
```

## Post-restore verification

Always after a restore:

```bash
# 1. Bot responds
python cli/leadai.py bot status acme-corp   # RUNNING

# 2. Leads are there
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-capture/leads.db \
  "SELECT COUNT(*), MAX(updated_at) FROM leads;"

# 3. Send a test DM and see if it captures

# 4. Portal loads
curl https://yourdomain.com/api/health
# log in and verify the tenant's /leads
```

## Backup testing

It's recommended to test the restore **in staging** every so often:

```bash
# Provision a test tenant
python cli/leadai.py tenants add --slug restore-test --name "Restore Test"
# ... provision ...

# Generate test data
# (send DMs to the bot)

# Backup
bash /usr/local/sbin/lead-ai-backup.sh

# Destroy the tenant
python cli/leadai.py provision destroy restore-test

# Restore from backup
# ... steps above ...

# Verify the data came back
```

If the restore works in staging, it will work in prod when you need it.

## Backup monitoring

The cron doesn't alert if it fails silently. Recommended:

```bash
# Check that there are recent backups
find /var/backups/lead-ai/ -mtime -1 -type f | wc -l
# should be > 0

# If you have Uptime Kuma or similar, hit an endpoint that verifies this
```
