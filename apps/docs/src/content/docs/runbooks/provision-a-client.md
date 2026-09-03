---
title: Provision a client
description: Step-by-step guide to onboarding a new tenant.
template: doc
---

# Runbook: Provision a client

Step-by-step recipe to onboard a new tenant with its bot.

## Prerequisites

- Repo cloned locally or on the VPS.
- `pnpm install` done.
- Client tokens/secrets at hand:
  - Telegram bot token (from [@BotFather](https://t.me/BotFather))
  - LLM API key (OpenAI / OpenRouter / custom)
  - Optional: Mem0 API key, embeddings key, Kapso API key + phone-number-id
- `hermes` binary on PATH (or installed in `~/.hermes/`).

## Step 1 — Register the tenant

```bash
python cli/leadai.py tenants add \
  --slug acme-corp \
  --name "Acme Corp"
```

This only adds metadata to the registry. **It does not provision.**

## Step 2 — (Optional) Knowledge base

If the client already has content, put it in:

```
examples/acme-corp/
├── SOUL.md                  # bot persona (optional, template available)
├── lead-capture-hints.txt   # custom hints for the extractor (optional)
└── knowledge/
    ├── faqs.md
    ├── catalog.md
    └── policies.md
```

If it doesn't exist, the default template from `packages/hermes-dist/SOUL.md` is used.

## Step 3 — Provision

**Safe mode (recommended):** secrets via env vars.

```bash
LEADAI_TELEGRAM_TOKEN="123:abc-TOKEN" \
LEADAI_MEM0_KEY="mem0-xxx" \
LEADAI_OPENAI_API_KEY="sk-xxx" \
  bash packages/ops/provision-client.sh \
    --slug acme-corp \
    --name "Acme Corp" \
    --model-provider openai \
    --model gpt-4o-mini
```

**Interactive mode** (wizard):

```bash
pnpm run setup:client
```

The wizard walks you through 7 steps. Note: it passes secrets via argv (less secure).

## Step 4 — Verify

```bash
# Gateway status
python cli/leadai.py bot status acme-corp
# should say: RUNNING

# Logs
python cli/leadai.py bot logs acme-corp -n 50

# Operator dashboard (Kanban tab)
# http://127.0.0.1:9119/leads
```

## Step 5 — Test with a DM

1. Open Telegram, search for the bot by username.
2. Send `/start`.
3. Send a message like "Hi, I want info about your services".
4. Verify the bot responds.
5. Verify it shows up in the Kanban: `hermes -p acme-corp-leads dashboard` → Leads tab.

## Step 6 — Full smoke test (optional but recommended)

```bash
bash packages/ops/validate-pilot.sh acme-corp-leads
```

Runs ~30 checks: layout, config security, RAG retrieval, lead-scope guardrails, lead-capture SQLite round-trip, lead-documents ingestion.

## Kapso (WhatsApp) — optional

If the client also wants WhatsApp:

```bash
LEADAI_TELEGRAM_TOKEN="..." \
LEADAI_KAPSO_API_KEY="kapso-xxx" \
LEADAI_OPENAI_API_KEY="sk-xxx" \
  bash packages/ops/provision-client.sh \
    --slug acme-corp \
    --name "Acme Corp" \
    --kapso-phone-number-id "12345" \
    --kapso-funnel-url "https://yourdomain.com/inbound/acme/kapso" \
    --owner-whatsapp-id "5491112345678"
```

The script will:

- Install the Kapso plugin.
- Generate `KAPSO_WEBHOOK_SECRET` (persistent).
- Run `hermes kapso setup` with the webhook.
- Set allowed-users to the owner.

Deterministic Kapso port: `8648 + (cksum(slug) % 50)`.

## Re-provision (idempotent)

If you changed the SOUL, added knowledge, or want to apply dist updates:

```bash
# Same command as always
LEADAI_TELEGRAM_TOKEN="..." \
  bash packages/ops/provision-client.sh --slug acme-corp --name "Acme Corp"

# Or force RAG re-ingest
bash packages/ops/provision-client.sh --slug acme-corp --name "Acme Corp" --reingest
```

The `.env` is merged (preserves unmanaged keys), `KAPSO_WEBHOOK_SECRET` is preserved, `allow_admin_from` is not duplicated.

## Sync with portal DB

If you're using the portal (not just the Hermes dashboard), after provisioning via CLI you need to create the tenant in the portal DB:

1. Log in to the portal as super_admin.
2. `/admin/tenants` → "New tenant" → slug + name + hermes_profile (`{slug}-leads`).
3. Assign members (client owner, etc).

> **Note:** the portal does NOT read `tenants.json`. If you provision via CLI and then manage via the portal, the two can diverge.

## Troubleshooting

### Bot does not respond

```bash
python cli/leadai.py bot status acme-corp   # stopped?
python cli/leadai.py bot logs acme-corp -n 100
python cli/leadai.py bot restart acme-corp
```

Verify the `TELEGRAM_BOT_TOKEN` is correct and that the bot isn't in use by another webhook.

### RAG returns nothing

```bash
hermes -p acme-corp-leads lead-rag ingest
hermes -p acme-corp-leads lead-rag search "test query"
```

If empty, check that `examples/acme-corp/knowledge/` has content and that the `LEAD_EMBEDDING_*` env vars are correct.

### Kapso webhook not arriving

```bash
# Local test
bash packages/ops/simulate-kapso-message.sh acme-corp-leads

# Verify public tunneling to the Kapso port
curl https://yourdomain.com/inbound/acme/kapso/health
```

### Python deps error

```bash
~/.hermes/hermes-agent/venv/bin/pip install -r packages/hermes-dist/requirements.txt
```

Mostly `pypdf` for PDFs.
