#!/usr/bin/env bash
# provision-client.sh — Provision a Hermes Leads Assistant client profile
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DIST_ROOT="${MONOREPO_ROOT}/packages/hermes-dist"

SLUG=""
CLIENT_NAME=""
TELEGRAM_TOKEN=""
OWNER_TELEGRAM_ID=""
MEM0_KEY=""
MODEL_PROVIDER=""
MODEL=""
MODEL_BASE_URL=""
OPENAI_API_KEY=""
LEAD_EMBEDDING_API_KEY=""
LEAD_EMBEDDING_BASE_URL=""
LEAD_EMBEDDING_MODEL=""
REINGEST=false
SKIP_GATEWAY=false
DRY_RUN=false
PERSIST_API_KEY="${PERSIST_API_KEY:-}"
KAPSO_API_KEY_FLAG=""
KAPSO_PHONE_NUMBER_ID=""
KAPSO_FUNNEL_URL=""
KAPSO_PORT=""
OWNER_WHATSAPP_ID=""
KAPSO_ALLOW_ALL=""
LANGFUSE_PUBLIC_KEY=""
LANGFUSE_SECRET_KEY=""
LANGFUSE_BASE_URL=""
LANGFUSE_ENV=""
ENABLE_LANGFUSE=false

usage() {
  cat <<'EOF'
Usage: provision-client.sh --slug SLUG --name "Client Name" [options]

Required:
  --slug SLUG                 Client slug (profile: {slug}-leads)
  --name "Client Name"        Display name for SOUL and config

Options:
  --telegram-token TOKEN      Telegram bot token
  --owner-telegram-id ID      Owner Telegram user ID (admin commands)
  --mem0-key KEY              Mem0 API key
  --model-provider PROVIDER     LLM provider (e.g. openai, openrouter, custom)
  --model MODEL               Default model slug
  --model-base-url URL        Custom LLM endpoint URL (required for custom provider)
  --openai-api-key KEY        OpenAI-compatible API key
  --embedding-api-key KEY     OpenAI-compatible embedding API key (LEAD_EMBEDDING_API_KEY)
  --embedding-base-url URL    Embedding endpoint base URL
  --embedding-model MODEL     Embedding model name
  --client-knowledge PATH     Copy knowledge/ from this path
  --catalog-vertical NAME     Catalog template: autos | inmobiliaria (default: autos;
                              canova-cars → autos + seed canova-autos)
  --reingest                  Force RAG re-ingest after copy
  --skip-gateway              Skip gateway install/start
  --dry-run                   Print actions without executing
  --kapso-api-key KEY         Kapso API key (triggers WhatsApp plugin install)
  --kapso-phone-number-id ID  Kapso WhatsApp phone number ID
  --kapso-funnel-url URL      Public HTTPS base for webhook (e.g. https://host/inbound/acme/kapso)
  --kapso-port PORT           Webhook listen port (default: derived from slug)
  --owner-whatsapp-id ID      Owner WhatsApp E.164 (admin + KAPSO_ALLOWED_USERS)
  --kapso-allow-all           Set KAPSO_ALLOW_ALL_USERS=true (dev/pilot only)
  --enable-langfuse           Wire shared ops Langfuse keys (LEADAI_LANGFUSE_* / flags)
  --langfuse-public-key KEY   Shared Langfuse public key (pk-lf-...) — same for all tenants
  --langfuse-secret-key KEY   Shared Langfuse secret key (sk-lf-...) — same for all tenants
  --langfuse-base-url URL     Langfuse URL (default: http://localhost:3100)
  --langfuse-env NAME         HERMES_LANGFUSE_ENV tag (default: SLUG — filter by tenant in UI)
  -h, --help                  Show this help

Langfuse model (ops-only):
  One Langfuse project, same API keys on every profile. Tenants never see Langfuse.
  HERMES_LANGFUSE_ENV defaults to the client slug so you can filter traces per tenant.

Example:
  bash packages/ops/provision-client.sh \
    --slug acme \
    --name "Acme Corp" \
    --telegram-token "$TELEGRAM_BOT_TOKEN" \
    --owner-telegram-id "123456789" \
    --mem0-key "$MEM0_API_KEY"
EOF
}

CLIENT_KNOWLEDGE=""
CATALOG_VERTICAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --name) CLIENT_NAME="$2"; shift 2 ;;
    --telegram-token) TELEGRAM_TOKEN="$2"; shift 2 ;;
    --owner-telegram-id) OWNER_TELEGRAM_ID="$2"; shift 2 ;;
    --mem0-key) MEM0_KEY="$2"; shift 2 ;;
    --model-provider) MODEL_PROVIDER="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --model-base-url) MODEL_BASE_URL="$2"; shift 2 ;;
    --openai-api-key) OPENAI_API_KEY="$2"; shift 2 ;;
    --embedding-api-key) LEAD_EMBEDDING_API_KEY="$2"; shift 2 ;;
    --embedding-base-url) LEAD_EMBEDDING_BASE_URL="$2"; shift 2 ;;
    --embedding-model) LEAD_EMBEDDING_MODEL="$2"; shift 2 ;;
    --client-knowledge) CLIENT_KNOWLEDGE="$2"; shift 2 ;;
    --catalog-vertical) CATALOG_VERTICAL="$2"; shift 2 ;;
    --reingest) REINGEST=true; shift ;;
    --skip-gateway) SKIP_GATEWAY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --kapso-api-key) KAPSO_API_KEY_FLAG="$2"; shift 2 ;;
    --kapso-phone-number-id) KAPSO_PHONE_NUMBER_ID="$2"; shift 2 ;;
    --kapso-funnel-url) KAPSO_FUNNEL_URL="$2"; shift 2 ;;
    --kapso-port) KAPSO_PORT="$2"; shift 2 ;;
    --owner-whatsapp-id) OWNER_WHATSAPP_ID="$2"; shift 2 ;;
    --kapso-allow-all) KAPSO_ALLOW_ALL=true; shift ;;
    --enable-langfuse) ENABLE_LANGFUSE=true; shift ;;
    --langfuse-public-key) LANGFUSE_PUBLIC_KEY="$2"; shift 2 ;;
    --langfuse-secret-key) LANGFUSE_SECRET_KEY="$2"; shift 2 ;;
    --langfuse-base-url) LANGFUSE_BASE_URL="$2"; shift 2 ;;
    --langfuse-env) LANGFUSE_ENV="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# Allow secrets to come from environment as a safer alternative to argv.
# CLI callers (leadai.py) should prefer the env form so tokens do not leak
# via `ps`/`/proc/<pid>/cmdline`. Explicit flags take precedence.
TELEGRAM_TOKEN="${TELEGRAM_TOKEN:-${LEADAI_TELEGRAM_TOKEN:-}}"
MEM0_KEY="${MEM0_KEY:-${LEADAI_MEM0_KEY:-}}"
OPENAI_API_KEY="${OPENAI_API_KEY:-${LEADAI_OPENAI_API_KEY:-}}"
LEAD_EMBEDDING_API_KEY="${LEAD_EMBEDDING_API_KEY:-${LEADAI_EMBEDDING_API_KEY:-}}"
KAPSO_API_KEY_FLAG="${KAPSO_API_KEY_FLAG:-${LEADAI_KAPSO_API_KEY:-}}"
LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-${LEADAI_LANGFUSE_PUBLIC_KEY:-}}"
LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-${LEADAI_LANGFUSE_SECRET_KEY:-}}"
LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-${LEADAI_LANGFUSE_BASE_URL:-}}"
LANGFUSE_ENV="${LANGFUSE_ENV:-${LEADAI_LANGFUSE_ENV:-}}"
if [[ "${LEADAI_ENABLE_LANGFUSE:-}" == "true" || "${LEADAI_ENABLE_LANGFUSE:-}" == "1" ]]; then
  ENABLE_LANGFUSE=true
fi
# Auto-enable when both keys are present (opt-in via secrets, no extra flag needed).
if [[ -n "$LANGFUSE_PUBLIC_KEY" && -n "$LANGFUSE_SECRET_KEY" ]]; then
  ENABLE_LANGFUSE=true
fi

if [[ -z "$SLUG" || -z "$CLIENT_NAME" ]]; then
  echo "Error: --slug and --name are required" >&2
  usage
  exit 1
fi

if [[ "$ENABLE_LANGFUSE" == true ]]; then
  LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-http://localhost:3100}"
  # Default ENV = tenant slug so Langfuse Environment filter = tenant.
  LANGFUSE_ENV="${LANGFUSE_ENV:-$SLUG}"
fi

PROFILE="${SLUG}-leads"
PROFILE_DIR="${HOME}/.hermes/profiles/${PROFILE}"

# Kapso opt-in: flag wins over env
KAPSO_API_KEY="${KAPSO_API_KEY_FLAG:-${KAPSO_API_KEY:-}}"
if [[ -z "$KAPSO_PORT" && -n "$KAPSO_API_KEY" ]]; then
  KAPSO_PORT=$((8648 + $(echo -n "$SLUG" | cksum | cut -d' ' -f1) % 50))
fi

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

echo "==> Provisioning Hermes Leads Assistant: ${PROFILE}"

# 0. Validate distribution source
bash "${SCRIPT_DIR}/validate-dist.sh"

# 1. Install distribution
if [[ -d "$PROFILE_DIR" && -f "$PROFILE_DIR/distribution.yaml" ]]; then
  echo "==> Profile exists — updating distribution"
  run hermes profile update "$PROFILE" --yes 2>/dev/null || run hermes -p "$PROFILE" profile update "$PROFILE" --yes 2>/dev/null || {
    echo "==> Update via install path"
    run hermes profile install "$DIST_ROOT" --name "$PROFILE" --yes
  }
else
  echo "==> Installing distribution from ${DIST_ROOT}"
  run hermes profile install "$DIST_ROOT" --name "$PROFILE" --yes
fi

# 1b. Opt out of Hermes bundled skills (github, productivity, etc.)
# Lead bots use knowledge/ RAG only. profile install may have been seeded
# before the marker landed — purge any synced catalog.
if [[ "$DRY_RUN" != true ]]; then
  if [[ -f "${DIST_ROOT}/.no-bundled-skills" ]]; then
    cp "${DIST_ROOT}/.no-bundled-skills" "${PROFILE_DIR}/.no-bundled-skills"
  else
    printf '%s\n' \
      "Hermes Leads Assistant — opted out of Hermes bundled-skill seeding." \
      > "${PROFILE_DIR}/.no-bundled-skills"
  fi
  if [[ -d "${PROFILE_DIR}/skills" ]]; then
    find "${PROFILE_DIR}/skills" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  else
    mkdir -p "${PROFILE_DIR}/skills"
  fi
  echo "==> Bundled skills disabled (.no-bundled-skills); skills/ cleared"
fi

# 2. Python deps (pypdf for lead-documents PDF extraction)
HERMES_PIP="${HOME}/.hermes/hermes-agent/venv/bin/pip"
if [[ -f "${DIST_ROOT}/requirements.txt" ]]; then
  echo "==> Installing Python dependencies into Hermes venv"
  if [[ -x "$HERMES_PIP" ]]; then
    run "$HERMES_PIP" install -r "${DIST_ROOT}/requirements.txt"
  else
    echo "Warning: Hermes venv pip not found — run: pip install -r ${DIST_ROOT}/requirements.txt" >&2
  fi
fi

# 3. Write .env (idempotent merge — preserves keys not managed by this script)
ENV_FILE="${PROFILE_DIR}/.env"
if [[ "$DRY_RUN" != true ]]; then
  mkdir -p "$PROFILE_DIR"

  # Auto-generate webhook secret ONCE, then persist across re-runs.
  if [[ -n "$KAPSO_API_KEY" && -z "${KAPSO_WEBHOOK_SECRET:-}" ]]; then
    if [[ -f "$ENV_FILE" ]] && grep -q '^KAPSO_WEBHOOK_SECRET=' "$ENV_FILE" 2>/dev/null; then
      KAPSO_WEBHOOK_SECRET="$(sed -n 's/^KAPSO_WEBHOOK_SECRET=//p' "$ENV_FILE")"
    else
      KAPSO_WEBHOOK_SECRET=$(openssl rand -base64 32 | tr -d '/+=' | head -c 43)
    fi
  fi

  # Build the desired key=value pairs managed by this script.
  tmp_env="$(mktemp)"
  {
    echo "# Generated by provision-client.sh — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_TOKEN}"
    echo "TELEGRAM_ALLOW_ALL_USERS=true"
    echo "MEM0_API_KEY=${MEM0_KEY}"
    echo "MEM0_AGENT_ID=${PROFILE}"
    if [[ -n "$OPENAI_API_KEY" ]]; then
      echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
    fi
    if [[ -n "$LEAD_EMBEDDING_API_KEY" ]]; then
      echo "LEAD_EMBEDDING_API_KEY=${LEAD_EMBEDDING_API_KEY}"
    elif [[ -n "$OPENAI_API_KEY" ]]; then
      echo "LEAD_EMBEDDING_API_KEY=${OPENAI_API_KEY}"
    fi
    [[ -n "$LEAD_EMBEDDING_BASE_URL" ]] && echo "LEAD_EMBEDDING_BASE_URL=${LEAD_EMBEDDING_BASE_URL}"
    [[ -n "$LEAD_EMBEDDING_MODEL" ]] && echo "LEAD_EMBEDDING_MODEL=${LEAD_EMBEDDING_MODEL}"
    if [[ -n "$KAPSO_API_KEY" ]]; then
      echo "KAPSO_API_KEY=${KAPSO_API_KEY}"
      [[ -n "$KAPSO_WEBHOOK_SECRET" ]] && echo "KAPSO_WEBHOOK_SECRET=${KAPSO_WEBHOOK_SECRET}"
      [[ -n "$KAPSO_PHONE_NUMBER_ID" ]] && echo "KAPSO_PHONE_NUMBER_ID=${KAPSO_PHONE_NUMBER_ID}"
      echo "KAPSO_PORT=${KAPSO_PORT}"
      if [[ "$KAPSO_ALLOW_ALL" == true ]]; then
        echo "KAPSO_ALLOW_ALL_USERS=true"
      elif [[ -n "$OWNER_WHATSAPP_ID" ]]; then
        echo "KAPSO_ALLOWED_USERS=${OWNER_WHATSAPP_ID}"
        echo "KAPSO_HOME_CHANNEL=${OWNER_WHATSAPP_ID}"
      fi
      [[ -n "$KAPSO_FUNNEL_URL" ]] && echo "KAPSO_WEBHOOK_URL=${KAPSO_FUNNEL_URL}/webhook"
    fi
    if [[ "$ENABLE_LANGFUSE" == true ]]; then
      [[ -n "$LANGFUSE_PUBLIC_KEY" ]] && echo "HERMES_LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}"
      [[ -n "$LANGFUSE_SECRET_KEY" ]] && echo "HERMES_LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}"
      echo "HERMES_LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL}"
      echo "HERMES_LANGFUSE_ENV=${LANGFUSE_ENV}"
      # Standard SDK names as fallbacks (Hermes-prefixed wins when both set).
      [[ -n "$LANGFUSE_PUBLIC_KEY" ]] && echo "LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}"
      [[ -n "$LANGFUSE_SECRET_KEY" ]] && echo "LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}"
      echo "LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL}"
    fi
  } > "$tmp_env"

  # Merge: start from existing env (if any), then override with managed keys.
  if [[ -f "$ENV_FILE" ]]; then
    managed_keys="$(grep -oE '^[A-Z_]+=' "$tmp_env" | sed 's/=$//' | tr '\n' '|')"
    # Keep only the lines from the old file whose key is NOT in managed_keys.
    awk -v keys="$managed_keys" '
      BEGIN {
        n = split(keys, arr, "|")
        for (i = 1; i <= n; i++) if (arr[i] != "") keep[arr[i]] = 1
      }
      /^[A-Z_]+=/ {
        k = $0; sub(/=.*/, "", k);
        if (k in keep) next;
      }
      { print }
    ' "$ENV_FILE" > "${ENV_FILE}.merged"
    cat "$tmp_env" >> "${ENV_FILE}.merged"
    mv "${ENV_FILE}.merged" "$ENV_FILE"
  else
    mv "$tmp_env" "$ENV_FILE"
  fi
  rm -f "$tmp_env"
  chmod 600 "$ENV_FILE"
  echo "==> Wrote ${ENV_FILE}"
else
  echo "[dry-run] write ${ENV_FILE}"
fi

# 4. Patch config.yaml — client_name, owner, model (via hermes config set)
if [[ "$DRY_RUN" != true && -f "${PROFILE_DIR}/config.yaml" ]]; then
  run hermes -p "$PROFILE" config set lead_assistant.client_name "$CLIENT_NAME" 2>/dev/null || true
  if [[ -n "$OWNER_TELEGRAM_ID" ]]; then
    run hermes -p "$PROFILE" config set lead_assistant.owner_telegram_id "$OWNER_TELEGRAM_ID" 2>/dev/null || true
    # allow_admin_from is a list — patch with sed fallback (idempotent: skip if already present)
    if ! grep -q "$OWNER_TELEGRAM_ID" "${PROFILE_DIR}/config.yaml" 2>/dev/null; then
      sed -i.bak "s/allow_admin_from: \\[\\]/allow_admin_from:\\n          - \"${OWNER_TELEGRAM_ID}\"/" "${PROFILE_DIR}/config.yaml" 2>/dev/null || true
      rm -f "${PROFILE_DIR}/config.yaml.bak"
    fi
  fi
  [[ -n "$MODEL_PROVIDER" ]] && run hermes -p "$PROFILE" config set model.provider "$MODEL_PROVIDER" 2>/dev/null || true
  [[ -n "$MODEL" ]] && run hermes -p "$PROFILE" config set model.default "$MODEL" 2>/dev/null || true
  [[ -n "$MODEL_BASE_URL" ]] && run hermes -p "$PROFILE" config set model.base_url "$MODEL_BASE_URL" 2>/dev/null || true
  # Default: do NOT persist the API key to config.yaml. It lives in .env
  # (chmod 600 above) and Hermes reads it via ${OPENAI_API_KEY} interpolation.
  # Only opt in to config.yaml storage for non-OpenAI custom endpoints that
  # do not support env interpolation (set PERSIST_API_KEY=true).
  if [[ "$PERSIST_API_KEY" == "true" && -n "$OPENAI_API_KEY" ]]; then
    run hermes -p "$PROFILE" config set model.api_key "$OPENAI_API_KEY" 2>/dev/null || true
    echo "==> WARNING: API key persisted to config.yaml (PERSIST_API_KEY=true). Ensure config.yaml has chmod 600."
  elif [[ -n "$OPENAI_API_KEY" && -f "${PROFILE_DIR}/config.yaml" ]]; then
    # Substitute the literal value, if present, with an env reference.
    # Idempotent: safe to run on already-substituted configs.
    if grep -q "model:" "${PROFILE_DIR}/config.yaml" 2>/dev/null; then
      sed -i.bak 's|api_key: .*[a-zA-Z0-9_-]\{20,\}.*|api_key: ${OPENAI_API_KEY}|' "${PROFILE_DIR}/config.yaml" 2>/dev/null || true
      rm -f "${PROFILE_DIR}/config.yaml.bak"
    fi
  fi
  if [[ -n "$LEAD_EMBEDDING_API_KEY" || -n "$OPENAI_API_KEY" ]]; then
    EMB_KEY="${LEAD_EMBEDDING_API_KEY:-$OPENAI_API_KEY}"
    if [[ "$PERSIST_API_KEY" == "true" ]]; then
      run hermes -p "$PROFILE" config set auxiliary.embeddings.api_key "$EMB_KEY" 2>/dev/null || true
    fi
    [[ -n "$LEAD_EMBEDDING_BASE_URL" ]] && run hermes -p "$PROFILE" config set auxiliary.embeddings.base_url "$LEAD_EMBEDDING_BASE_URL" 2>/dev/null || true
    [[ -n "$LEAD_EMBEDDING_MODEL" ]] && run hermes -p "$PROFILE" config set auxiliary.embeddings.model "$LEAD_EMBEDDING_MODEL" 2>/dev/null || true
  fi
  if [[ -n "$OWNER_WHATSAPP_ID" ]]; then
    run hermes -p "$PROFILE" config set lead_assistant.owner_whatsapp_id "$OWNER_WHATSAPP_ID" 2>/dev/null || true
  fi
  echo "==> Patched config for ${CLIENT_NAME}"

  # Enforce no-thinking on lead aux tasks (qwen3.6/nan otherwise stalls 30–90s).
  # Idempotent: merges into existing auxiliary.* blocks for new + re-provisioned profiles.
  python3 - <<'PY' || true
from pathlib import Path
try:
    import yaml
except ImportError:
    raise SystemExit(0)

path = Path("${PROFILE_DIR}/config.yaml")
cfg = yaml.safe_load(path.read_text()) or {}
aux = cfg.setdefault("auxiliary", {})
if not isinstance(aux, dict):
    raise SystemExit(0)
changed = False
for task in ("lead_verifier", "lead_extractor", "lead_classifier"):
    block = aux.get(task)
    if block is None:
        block = {"provider": "auto", "model": "", "timeout": 30}
        aux[task] = block
        changed = True
    if not isinstance(block, dict):
        continue
    eb = block.get("extra_body")
    if not isinstance(eb, dict):
        eb = {}
        block["extra_body"] = eb
        changed = True
    if eb.get("enable_thinking") is not False:
        eb["enable_thinking"] = False
        changed = True
    ctk = eb.get("chat_template_kwargs")
    if not isinstance(ctk, dict):
        ctk = {}
        eb["chat_template_kwargs"] = ctk
        changed = True
    if ctk.get("enable_thinking") is not False:
        ctk["enable_thinking"] = False
        changed = True
if changed:
    path.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
    print("==> Ensured auxiliary lead_* enable_thinking=false")
PY

  # Restrict permissions on config.yaml — it may contain a key under PERSIST_API_KEY.
  chmod 600 "${PROFILE_DIR}/config.yaml" 2>/dev/null || true
fi

# 5. SOUL.md — client override or template personalize
SOUL_FILE="${PROFILE_DIR}/SOUL.md"
CLIENT_SOUL="${MONOREPO_ROOT}/examples/${SLUG}/SOUL.md"
if [[ "$DRY_RUN" != true && -f "$CLIENT_SOUL" ]]; then
  cp "$CLIENT_SOUL" "$SOUL_FILE"
  echo "==> Installed SOUL.md from examples/${SLUG}/SOUL.md"
elif [[ "$DRY_RUN" != true && -f "$SOUL_FILE" ]]; then
  sed -i.bak "s/{client_name}/${CLIENT_NAME}/g" "$SOUL_FILE" && rm -f "${SOUL_FILE}.bak"
  echo "==> Personalized SOUL.md"
fi

# 5b. lead_capture.extraction_hints from examples/{slug}/lead-capture-hints.txt
HINTS_FILE="${MONOREPO_ROOT}/examples/${SLUG}/lead-capture-hints.txt"
if [[ "$DRY_RUN" != true && -f "$HINTS_FILE" && -f "${PROFILE_DIR}/config.yaml" ]]; then
  run hermes -p "$PROFILE" config set lead_capture.extraction_hints "$(cat "$HINTS_FILE")" 2>/dev/null || true
  echo "==> Set lead_capture.extraction_hints from examples/${SLUG}/"
fi

# 6. Copy client knowledge
KNOWLEDGE_SRC="${CLIENT_KNOWLEDGE:-${MONOREPO_ROOT}/examples/${SLUG}/knowledge}"
KNOWLEDGE_DST="${PROFILE_DIR}/knowledge"
if [[ -d "$KNOWLEDGE_SRC" ]]; then
  echo "==> Copying knowledge from ${KNOWLEDGE_SRC}"
  run mkdir -p "$KNOWLEDGE_DST"
  if [[ "$DRY_RUN" != true ]]; then
    cp -R "${KNOWLEDGE_SRC}/." "$KNOWLEDGE_DST/"
  fi
elif [[ ! -d "$KNOWLEDGE_DST" ]]; then
  run mkdir -p "$KNOWLEDGE_DST"
fi

# 7. Enable plugins
echo "==> Enabling plugins"
for plug in lead-scope lead-rag lead-capture lead-documents lead-verify lead-catalog; do
  run hermes -p "$PROFILE" plugins enable "$plug" 2>/dev/null || true
done

# 7a. Structured catalog (SQLite) — vertical templates autos | inmobiliaria
if [[ -z "$CATALOG_VERTICAL" ]]; then
  if [[ "$SLUG" == "canova-cars" ]]; then
    CATALOG_VERTICAL="autos"
  else
    CATALOG_VERTICAL="autos"
  fi
fi
if [[ "$CATALOG_VERTICAL" != "autos" && "$CATALOG_VERTICAL" != "inmobiliaria" ]]; then
  echo "Warning: invalid --catalog-vertical=${CATALOG_VERTICAL}; using autos" >&2
  CATALOG_VERTICAL="autos"
fi
echo "==> Initializing catalog.db (vertical=${CATALOG_VERTICAL})"
run hermes -p "$PROFILE" config set lead_catalog.vertical "$CATALOG_VERTICAL" 2>/dev/null || true
run hermes -p "$PROFILE" lead-catalog init --vertical "$CATALOG_VERTICAL" 2>/dev/null || {
  if [[ "$DRY_RUN" != true ]]; then
    "${HOME}/.hermes/hermes-agent/venv/bin/python" <<PY || true
import os, sys, importlib.util
from pathlib import Path
os.environ["HERMES_HOME"] = "${PROFILE_DIR}"
cat_dir = Path("${PROFILE_DIR}") / "plugins" / "lead-catalog"
if not cat_dir.is_dir():
    cat_dir = Path("${DIST_ROOT}") / "plugins" / "lead-catalog"
pkg = "lead_catalog_plugin"
sys.modules[pkg] = type(sys)("x")
sys.modules[pkg].__path__ = [str(cat_dir)]
for sub in ("templates", "store", "seed", "schemas"):
    path = cat_dir / f"{sub}.py"
    spec = importlib.util.spec_from_file_location(f"{pkg}.{sub}", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{pkg}.{sub}"] = mod
    spec.loader.exec_module(mod)
store = sys.modules[f"{pkg}.store"]
store.init_catalog("${CATALOG_VERTICAL}", Path("${PROFILE_DIR}"))
print("==> catalog.db initialized")
PY
  fi
}
if [[ "$SLUG" == "canova-cars" && "$CATALOG_VERTICAL" == "autos" ]]; then
  echo "==> Seeding Canova autos catalog from inventario migration pack"
  run hermes -p "$PROFILE" lead-catalog seed canova-autos 2>/dev/null || {
    if [[ "$DRY_RUN" != true ]]; then
      "${HOME}/.hermes/hermes-agent/venv/bin/python" <<PY || true
import os, sys, importlib.util
from pathlib import Path
os.environ["HERMES_HOME"] = "${PROFILE_DIR}"
cat_dir = Path("${PROFILE_DIR}") / "plugins" / "lead-catalog"
if not cat_dir.is_dir():
    cat_dir = Path("${DIST_ROOT}") / "plugins" / "lead-catalog"
pkg = "lead_catalog_plugin"
# Load package
for name in list(sys.modules):
    pass
sys.path.insert(0, str(cat_dir.parent))
# file-based load
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod
templates = load(f"{pkg}.templates", cat_dir / "templates.py")
store = load(f"{pkg}.store", cat_dir / "store.py")
# patch relative imports used inside store
sys.modules[f"{pkg}.templates"] = templates
seed = load(f"{pkg}.seed", cat_dir / "seed.py")
# re-exec store with package context
import types
pkgmod = types.ModuleType(pkg)
pkgmod.__path__ = [str(cat_dir)]
sys.modules[pkg] = pkgmod
sys.modules[f"{pkg}.templates"] = templates
sys.modules[f"{pkg}.store"] = store
sys.modules[f"{pkg}.seed"] = seed
store.init_catalog("autos", Path("${PROFILE_DIR}"))
conn = store.get_connection(Path("${PROFILE_DIR}"))
if store.count_items(conn) == 0:
    for p in seed.CANOVA_AUTOS:
        store.create_item(conn, p)
    store.export_rag_markdown(conn, Path("${PROFILE_DIR}"))
    print(f"==> Seeded {store.count_items(conn)} autos")
else:
    print("==> Catalog already has items; seed skipped")
conn.close()
PY
    fi
  }
  run hermes -p "$PROFILE" lead-catalog export-rag 2>/dev/null || true
fi

# Bundled Hermes Langfuse plugin (opt-in when keys / --enable-langfuse)
if [[ "$ENABLE_LANGFUSE" == true ]]; then
  echo "==> Enabling observability/langfuse (BASE_URL=${LANGFUSE_BASE_URL})"
  run hermes -p "$PROFILE" plugins enable observability/langfuse 2>/dev/null || true
  if [[ -x "$HERMES_PIP" ]]; then
    run "$HERMES_PIP" install 'langfuse>=4.14,<5' 2>/dev/null || true
  fi
  if [[ -z "$LANGFUSE_PUBLIC_KEY" || -z "$LANGFUSE_SECRET_KEY" ]]; then
    echo "Warning: Langfuse enabled but keys missing — set LEADAI_LANGFUSE_PUBLIC_KEY / LEADAI_LANGFUSE_SECRET_KEY" >&2
    echo "  Local stack: packages/ops/langfuse (http://localhost:3100)" >&2
  fi
fi

# mem0 is a bundled plugin — enable via config, not "plugins enable"
if [[ -n "$MEM0_KEY" ]]; then
  echo "==> Configuring Mem0 memory provider"
  run hermes -p "$PROFILE" config set memory.provider mem0 2>/dev/null || true
  # Ensure mem0ai Python package is installed
  if [[ -x "$HERMES_PIP" ]]; then
    run "$HERMES_PIP" install mem0ai 2>/dev/null || true
  fi
fi

# 7b. Kapso WhatsApp (opt-in when KAPSO_API_KEY is set)
if [[ -n "$KAPSO_API_KEY" ]]; then
  echo "==> Kapso WhatsApp (opt-in)"
  # If plugins/kapso exists but is empty (failed clone), remove it first
  KAPSO_DIR="${PROFILE_DIR}/plugins/kapso"
  if [[ -d "$KAPSO_DIR" && -z "$(ls -A "$KAPSO_DIR" 2>/dev/null)" ]]; then
    echo "==> Removing empty kapso directory (previous install failed)"
    rm -rf "$KAPSO_DIR"
  fi
  # Try install; if already exists, try update; if that fails too, just enable it
  run hermes -p "$PROFILE" plugins install gokapso/hermes-agent-plugin --enable 2>/dev/null || \
    run hermes -p "$PROFILE" plugins update gokapso/hermes-agent-plugin --enable 2>/dev/null || \
    run hermes -p "$PROFILE" plugins enable kapso 2>/dev/null || true

  if [[ "$DRY_RUN" != true && -f "${PROFILE_DIR}/config.yaml" ]]; then
    python3 <<PY || true
from pathlib import Path
import re
path = Path("${PROFILE_DIR}/config.yaml")
text = path.read_text()
text = re.sub(
    r'(platforms:\s*\n(?:.*\n)*?    kapso:\s*\n      )enabled: false',
    r'\1enabled: true',
    text,
    count=1,
)
path.write_text(text)
PY
  fi

  if [[ -x "$HERMES_PIP" ]]; then
    run "$HERMES_PIP" install 'aiohttp>=3.9,<4' 2>/dev/null || true
  fi

  if [[ -n "$KAPSO_FUNNEL_URL" ]]; then
    SETUP_ARGS=(
      --api-key "$KAPSO_API_KEY"
      --funnel-url "$KAPSO_FUNNEL_URL"
      --configure-webhook
      --install-cli
      --no-prompt
    )
    [[ -n "$KAPSO_PHONE_NUMBER_ID" ]] && SETUP_ARGS+=(--phone-number-id "$KAPSO_PHONE_NUMBER_ID")
    [[ -n "$OWNER_WHATSAPP_ID" ]] && SETUP_ARGS+=(--home-channel "$OWNER_WHATSAPP_ID" --allowed-users "$OWNER_WHATSAPP_ID")
    if [[ "$KAPSO_ALLOW_ALL" == true ]]; then
      SETUP_ARGS+=(--allow-all-users)
    fi
    run hermes -p "$PROFILE" kapso setup "${SETUP_ARGS[@]}" 2>/dev/null || \
      echo "Warning: hermes kapso setup failed — configure webhook manually" >&2
  else
    echo "Warning: --kapso-funnel-url omitted — plugin installed; run: ${PROFILE} kapso setup" >&2
  fi
else
  echo "==> Kapso skipped (no KAPSO_API_KEY)"
fi

# 8. RAG ingest
echo "==> Ingesting knowledge base"
run hermes -p "$PROFILE" lead-rag ingest 2>/dev/null || {
  # Direct ingest via plugin module (load submodules for relative imports)
  if [[ "$DRY_RUN" != true ]]; then
    "${HOME}/.hermes/hermes-agent/venv/bin/python" <<PY
import os, sys, importlib.util
from pathlib import Path

os.environ["HERMES_HOME"] = "${PROFILE_DIR}"
profile = Path("${PROFILE_DIR}")
agent = Path("${HOME}/.hermes/hermes-agent")
sys.path.insert(0, str(agent))

rag_dir = profile / "plugins" / "lead-rag"
pkg = "lead_rag_plugin"
for sub in ("embeddings", "fts", "rerank", "vector_store"):
    mod_name = f"{pkg}.{sub}"
    path = rag_dir / f"{sub}.py"
    spec = importlib.util.spec_from_file_location(mod_name, path, submodule_search_locations=[str(rag_dir)])
    submod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = submod
    spec.loader.exec_module(submod)
init_path = rag_dir / "__init__.py"
spec = importlib.util.spec_from_file_location(pkg, init_path, submodule_search_locations=[str(rag_dir)])
mod = importlib.util.module_from_spec(spec)
mod.__package__ = pkg
sys.modules[pkg] = mod
spec.loader.exec_module(mod)
count = mod.ingest()
print(f"==> Indexed {count} chunks")
PY
  fi
}

# 9. Gateway
if [[ "$SKIP_GATEWAY" != true ]]; then
  echo "==> Installing and starting gateway"
  run hermes -p "$PROFILE" gateway install 2>/dev/null || true
  run hermes -p "$PROFILE" gateway start 2>/dev/null || true
fi

echo ""
echo "✓ Provisioned ${PROFILE}"
echo "  Profile:  ${PROFILE_DIR}"
echo "  Alias:    ${PROFILE} <command>"
echo "  Mem0 ID:  ${PROFILE}"
echo ""
echo "Next: send a Telegram DM to the bot and run:"
echo "  ${PROFILE} gateway status"
echo "  ${PROFILE} sessions list"
echo "  ${PROFILE} dashboard    # Kanban Leads tab at http://127.0.0.1:9119/leads"
if [[ -n "$KAPSO_API_KEY" ]]; then
  echo "  ${PROFILE} kapso status"
  echo "  curl http://127.0.0.1:${KAPSO_PORT}/health"
  echo "  bash packages/ops/simulate-kapso-message.sh ${PROFILE}"
fi
if [[ "$ENABLE_LANGFUSE" == true ]]; then
  echo "  Langfuse: ${LANGFUSE_BASE_URL}  (look for \"Hermes turn\" traces)"
  echo "  Local stack: cd packages/ops/langfuse && docker compose up -d"
fi
