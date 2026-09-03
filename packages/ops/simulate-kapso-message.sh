#!/usr/bin/env bash
# simulate-kapso-message.sh — POST a Kapso v2 webhook payload to a profile gateway
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROFILE="${1:-pilot-leads}"
shift || true

FROM=""
TEXT=""
FIXTURE="${SCRIPT_DIR}/fixtures/kapso-message-received.json"
PORT=""
PATH_SUFFIX="/kapso/webhook"
VERIFY_SIG=true

usage() {
  cat <<'EOF'
Usage: simulate-kapso-message.sh [PROFILE] [options]

Options:
  --from NUMBER       Sender WhatsApp E.164 (default: 5491112345678)
  --text TEXT         Message body (default: from fixture)
  --port PORT         Override KAPSO_PORT
  --path PATH         Webhook path (default: /kapso/webhook)
  --no-signature      Skip HMAC signature (requires KAPSO_VERIFY_WEBHOOK_SIGNATURES=false on gateway)
  -h, --help          Show help

Reads KAPSO_WEBHOOK_SECRET and KAPSO_PORT from ~/.hermes/profiles/PROFILE/.env
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="$2"; shift 2 ;;
    --text) TEXT="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --path) PATH_SUFFIX="$2"; shift 2 ;;
    --no-signature) VERIFY_SIG=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

PROFILE_DIR="${HOME}/.hermes/profiles/${PROFILE}"
ENV_FILE="${PROFILE_DIR}/.env"

[[ -f "$ENV_FILE" ]] || { echo "Missing ${ENV_FILE}" >&2; exit 1; }

# shellcheck disable=SC1090
source <(grep -E '^KAPSO_' "$ENV_FILE" | sed 's/^/export /')

PORT="${PORT:-${KAPSO_PORT:-8648}}"
SECRET="${KAPSO_WEBHOOK_SECRET:-}"
URL="http://127.0.0.1:${PORT}${PATH_SUFFIX}"

FROM="${FROM:-5491112345678}"
if [[ -n "$TEXT" ]]; then
  BODY=$(python3 -c "
import json, sys
from pathlib import Path
data = json.loads(Path('${FIXTURE}').read_text())
data['data']['message']['from'] = '${FROM}'
data['data']['message']['text']['body'] = sys.argv[1]
print(json.dumps(data))
" "$TEXT")
else
  BODY=$(python3 -c "
import json
from pathlib import Path
data = json.loads(Path('${FIXTURE}').read_text())
data['data']['message']['from'] = '${FROM}'
print(json.dumps(data))
")
fi

HEADERS=(-H "Content-Type: application/json" -H "X-Webhook-Event: whatsapp.message.received" -H "X-Webhook-Payload-Version: v2")

if [[ "$VERIFY_SIG" == true && -n "$SECRET" ]]; then
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
  HEADERS+=(-H "X-Webhook-Signature: ${SIG}")
elif [[ "$VERIFY_SIG" == true && -z "$SECRET" ]]; then
  echo "Warning: KAPSO_WEBHOOK_SECRET empty — use --no-signature or set secret in .env" >&2
fi

echo "==> POST ${URL}"
HTTP_CODE=$(curl -sS -o /tmp/kapso-sim-response.txt -w "%{http_code}" -X POST "${URL}" "${HEADERS[@]}" -d "$BODY")
echo "HTTP ${HTTP_CODE}"
cat /tmp/kapso-sim-response.txt
echo ""

[[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "204" ]] || exit 1
