#!/usr/bin/env bash
# smoke-check.sh — verify local Langfuse is reachable on :3100
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BASE_URL="${LANGFUSE_SMOKE_URL:-http://127.0.0.1:3100}"
MAX_WAIT="${LANGFUSE_SMOKE_WAIT_SECS:-180}"

web_up=false
if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -qiE '^langfuse-web (running|up)'; then
  web_up=true
elif docker compose ps 2>/dev/null | grep -qE 'langfuse-web.*(Up|running)'; then
  web_up=true
fi

if [[ "$web_up" != true ]]; then
  echo "langfuse-web does not look running. Start with: docker compose up -d" >&2
  docker compose ps >&2 || true
  exit 1
fi

echo "==> Waiting for Langfuse UI at ${BASE_URL} (up to ${MAX_WAIT}s)"
deadline=$((SECONDS + MAX_WAIT))
while (( SECONDS < deadline )); do
  code="$(curl -sS -o /dev/null --max-time 3 -w '%{http_code}' "$BASE_URL" || true)"
  if [[ "$code" =~ ^(200|302|307|308)$ ]]; then
    echo "✓ Langfuse UI responds at ${BASE_URL} (HTTP ${code})"
    echo "  Next: open the UI, confirm project keys, wire HERMES_LANGFUSE_* on a profile,"
    echo "  send a bot DM, then look for a \"Hermes turn\" trace with tokens/cost."
    exit 0
  fi
  sleep 3
done

echo "✗ Timed out waiting for ${BASE_URL}" >&2
docker compose ps >&2 || true
docker compose logs --tail=40 langfuse-web >&2 || true
exit 1
