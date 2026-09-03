#!/usr/bin/env bash
# sync-profiles.sh — Wire shared ops Langfuse keys into every *-leads Hermes profile.
#
# Model A (ops-only): one Langfuse project, same pk/sk on all tenants.
# HERMES_LANGFUSE_ENV=<slug> so you can filter traces per tenant in the UI.
#
# Usage:
#   bash packages/ops/langfuse/sync-profiles.sh
#   bash packages/ops/langfuse/sync-profiles.sh --dry-run
#   LEADAI_LANGFUSE_PUBLIC_KEY=pk-lf-... LEADAI_LANGFUSE_SECRET_KEY=sk-lf-... \
#     bash packages/ops/langfuse/sync-profiles.sh
#
# Keys resolve in order:
#   1. LEADAI_LANGFUSE_* / HERMES_LANGFUSE_* env
#   2. LANGFUSE_INIT_PROJECT_* from packages/ops/langfuse/.env
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_ROOT="${HERMES_PROFILES_ROOT:-${HOME}/.hermes/profiles}"
HERMES_PIP="${HOME}/.hermes/hermes-agent/venv/bin/pip"
DRY_RUN=false
BASE_URL_DEFAULT="http://localhost:3100"

usage() {
  cat <<'EOF'
Usage: sync-profiles.sh [--dry-run] [--help]

Push shared Langfuse API keys into every ~/.hermes/profiles/*-leads/.env,
set HERMES_LANGFUSE_ENV=<slug>, enable observability/langfuse, install SDK.

Ops-only: tenants never see Langfuse. Filter in the UI by Environment = slug.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# --- Load keys from compose .env if present ---
load_dotenv_key() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  local line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  printf '%s' "${line#*=}"
}

COMPOSE_ENV="${ROOT}/.env"
PUBLIC_KEY="${LEADAI_LANGFUSE_PUBLIC_KEY:-${HERMES_LANGFUSE_PUBLIC_KEY:-}}"
SECRET_KEY="${LEADAI_LANGFUSE_SECRET_KEY:-${HERMES_LANGFUSE_SECRET_KEY:-}}"
BASE_URL="${LEADAI_LANGFUSE_BASE_URL:-${HERMES_LANGFUSE_BASE_URL:-}}"

if [[ -z "$PUBLIC_KEY" ]]; then
  PUBLIC_KEY="$(load_dotenv_key "$COMPOSE_ENV" LANGFUSE_INIT_PROJECT_PUBLIC_KEY)"
fi
if [[ -z "$SECRET_KEY" ]]; then
  SECRET_KEY="$(load_dotenv_key "$COMPOSE_ENV" LANGFUSE_INIT_PROJECT_SECRET_KEY)"
fi
if [[ -z "$BASE_URL" ]]; then
  BASE_URL="$(load_dotenv_key "$COMPOSE_ENV" NEXTAUTH_URL)"
fi
BASE_URL="${BASE_URL:-$BASE_URL_DEFAULT}"

if [[ -z "$PUBLIC_KEY" || -z "$SECRET_KEY" ]]; then
  echo "Error: missing Langfuse API keys." >&2
  echo "  Set LEADAI_LANGFUSE_PUBLIC_KEY + LEADAI_LANGFUSE_SECRET_KEY, or" >&2
  echo "  ensure ${COMPOSE_ENV} has LANGFUSE_INIT_PROJECT_PUBLIC_KEY / SECRET_KEY." >&2
  exit 1
fi

if [[ ! -d "$PROFILES_ROOT" ]]; then
  echo "Error: profiles dir not found: ${PROFILES_ROOT}" >&2
  exit 1
fi

echo "==> Shared Langfuse sync"
echo "  BASE_URL=${BASE_URL}"
echo "  PUBLIC_KEY=${PUBLIC_KEY:0:12}…"
echo "  profiles: ${PROFILES_ROOT}/*-leads"

# Install SDK once into Hermes venv
if [[ -x "$HERMES_PIP" ]]; then
  echo "==> Ensuring langfuse SDK in Hermes venv"
  run "$HERMES_PIP" install 'langfuse>=4.14,<5'
else
  echo "Warning: Hermes venv pip not found at ${HERMES_PIP}" >&2
fi

merge_env_keys() {
  local env_file="$1"
  local slug="$2"
  local tmp
  tmp="$(mktemp)"
  {
    echo "HERMES_LANGFUSE_PUBLIC_KEY=${PUBLIC_KEY}"
    echo "HERMES_LANGFUSE_SECRET_KEY=${SECRET_KEY}"
    echo "HERMES_LANGFUSE_BASE_URL=${BASE_URL}"
    echo "HERMES_LANGFUSE_ENV=${slug}"
    echo "LANGFUSE_PUBLIC_KEY=${PUBLIC_KEY}"
    echo "LANGFUSE_SECRET_KEY=${SECRET_KEY}"
    echo "LANGFUSE_BASE_URL=${BASE_URL}"
  } > "$tmp"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] merge Langfuse keys into ${env_file} (ENV=${slug})"
    rm -f "$tmp"
    return 0
  fi

  mkdir -p "$(dirname "$env_file")"
  if [[ -f "$env_file" ]]; then
    managed='HERMES_LANGFUSE_PUBLIC_KEY|HERMES_LANGFUSE_SECRET_KEY|HERMES_LANGFUSE_BASE_URL|HERMES_LANGFUSE_ENV|LANGFUSE_PUBLIC_KEY|LANGFUSE_SECRET_KEY|LANGFUSE_BASE_URL'
    awk -v keys="$managed" '
      BEGIN {
        n = split(keys, arr, "|")
        for (i = 1; i <= n; i++) if (arr[i] != "") drop[arr[i]] = 1
      }
      /^[A-Z_]+=/ {
        k = $0; sub(/=.*/, "", k);
        if (k in drop) next;
      }
      { print }
    ' "$env_file" > "${env_file}.merged"
    cat "$tmp" >> "${env_file}.merged"
    mv "${env_file}.merged" "$env_file"
  else
    mv "$tmp" "$env_file"
  fi
  rm -f "$tmp"
  chmod 600 "$env_file"
}

count=0
shopt -s nullglob
for profile_dir in "${PROFILES_ROOT}"/*-leads; do
  [[ -d "$profile_dir" ]] || continue
  profile="$(basename "$profile_dir")"
  slug="${profile%-leads}"
  env_file="${profile_dir}/.env"

  echo "==> ${profile} (ENV=${slug})"
  merge_env_keys "$env_file" "$slug"
  run hermes -p "$profile" plugins enable observability/langfuse 2>/dev/null || \
    echo "  Warning: could not enable observability/langfuse on ${profile}" >&2
  count=$((count + 1))
done
shopt -u nullglob

if [[ "$count" -eq 0 ]]; then
  echo "No *-leads profiles found under ${PROFILES_ROOT}"
  exit 0
fi

echo ""
echo "✓ Synced Langfuse into ${count} profile(s)"
echo "  UI: ${BASE_URL}"
echo "  Filter traces by Environment = <slug> (e.g. canova-cars)"
echo "  Test: portal playground → message → Langfuse Traces"
if [[ "$DRY_RUN" != true ]]; then
  echo "  Tip: restart gateways if bots were already running so they reload .env"
fi
