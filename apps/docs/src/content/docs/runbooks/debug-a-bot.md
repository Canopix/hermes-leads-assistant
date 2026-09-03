---
title: Debug a bot
description: How to diagnose a bot that doesn't respond or misbehaves.
template: doc
---

# Runbook: Debug a bot

Decision tree for diagnosing bots that don't respond or act weird.

## The bot doesn't respond

```mermaid
flowchart TB
    NO[Bot does not respond] --> STATUS{bot status?}
    STATUS -->|stopped| START[bot start]
    STATUS -->|RUNNING| TOKEN{Valid token?}
    START --> CHECK[verify again]
    TOKEN -->|no| BF[@BotFather revoke + update .env]
    TOKEN -->|yes| WEBHOOK{Webhook in conflict?}
    WEBHOOK -->|yes| DEL[deleteWebhook]
    WEBHOOK -->|no| LOGS[bot logs -n 100]
    LOGS --> ERR{Clear error?}
    ERR -->|yes| FIX[apply specific fix]
    ERR -->|no| RESTART[bot restart]
```

### Key commands

```bash
# General status
python cli/leadai.py bot status acme-corp

# Profile logs
python cli/leadai.py bot logs acme-corp -n 100

# Clean restart
python cli/leadai.py bot restart acme-corp
```

### Telegram webhook in conflict

If the token was used somewhere else, the webhook may be pointing to the wrong place:

```bash
# See where the webhook points
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Delete webhook (Hermes uses long polling)
curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

Then restart the bot.

## The bot responds badly (hallucinates, out of scope)

### Check scope

```bash
# View config
cat ~/.hermes/profiles/acme-corp-leads/config.yaml | grep -A 20 lead_assistant
```

`allowed_topics`, `business_hours`, and owner IDs must be correct.

### Test lead-scope

```bash
hermes -p acme-corp-leads plugins run lead-scope -- test
# or via validate-pilot.sh
bash packages/ops/validate-pilot.sh acme-corp-leads
```

It verifies:

- `terminal` tool blocked.
- `mem0_conclude` with poisoned content → blocked.
- Prompt injection detected.
- Slash commands admin-only.

### Check tools allowlist

```bash
# Check the toolset config
grep -A 10 platform_toolsets ~/.hermes/profiles/acme-corp-leads/config.yaml
```

It must not have `terminal`, `web`, `skills`.

## The bot responds but doesn't capture leads

### Check lead-capture

```bash
# Direct DB query
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-capture/leads.db \
  "SELECT id, name, temperature, kanban_column, last_extracted_at FROM leads ORDER BY updated_at DESC LIMIT 5;"

# View events
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-capture/leads.db \
  "SELECT lead_id, event_type, payload, created_at FROM lead_events ORDER BY id DESC LIMIT 10;"
```

### Possible causes

| Symptom | Cause | Fix |
|---|---|---|
| No `extracted` events | Aggressive throttle or extractor failing | Check `lead_capture.min_interval_seconds` and logs |
| `extracted` events but `temperature` always `tibio` | Degraded LLM extractor | Check `auxiliary.lead_extractor` config |
| `manual_override=1` for all | Someone moved cards and locked them | `clearLeadManualOverride` via portal API |
| `kanban_column` doesn't change | `manual_override` or extractor not running | Check the enabled flag |

### Test the extractor standalone

```bash
# Edit .lead-capture-hints.txt and re-provision
bash packages/ops/provision-client.sh --slug acme-corp --name "Acme Corp"

# Or set hints directly
hermes -p acme-corp-leads config set lead_capture.extraction_hints "..."
```

## RAG doesn't contribute context

### Check ingest

```bash
# Index status
hermes -p acme-corp-leads lead-rag ingest    # re-ingest
hermes -p acme-corp-leads lead-rag search "pro plan price"
```

### Check embeddings

```bash
cat ~/.hermes/profiles/acme-corp-leads/.env | grep LEAD_EMBEDDING
```

If `LEAD_EMBEDDING_API_KEY` is missing, it degrades to FTS (exact text, not semantic).

### Check indexed chunks

```bash
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-rag/vectors.db \
  "SELECT COUNT(*) FROM chunks;"

sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-rag/index.db \
  "SELECT COUNT(*) FROM documents;"
```

## Lead documents aren't processed

```bash
# Stats
hermes -p acme-corp-leads lead-documents stats

# View stored files
ls ~/.hermes/profiles/acme-corp-leads/.lead-documents/files/

# View DB
sqlite3 ~/.hermes/profiles/acme-corp-leads/.lead-documents/docs.db \
  "SELECT filename, char_count FROM documents ORDER BY created_at DESC LIMIT 5;"
```

If `char_count=0`, the extractor failed — probably a PDF without text or a corrupt DOCX. Install `pdftotext` as a fallback:

```bash
sudo apt install poppler-utils
```

## Detailed logs

```bash
# All profile logs
ls ~/.hermes/profiles/acme-corp-leads/logs/

# Live tail
tail -f ~/.hermes/profiles/acme-corp-leads/logs/*.log

# Portal errors
# (VPS deploy) journalctl -u leadai-portal -f
```

## Nuclear reset (last resort)

If the profile is corrupt and you want to start from scratch **losing data**:

```bash
python cli/leadai.py provision destroy acme-corp --no-archive
python cli/leadai.py tenants remove acme-corp --force

# Re-provision from scratch
python cli/leadai.py tenants add --slug acme-corp --name "Acme Corp"
LEADAI_TELEGRAM_TOKEN="..." bash packages/ops/provision-client.sh --slug acme-corp --name "Acme Corp"
```

> Only if you have a backup or the data doesn't matter. To preserve data, use the normal [deprovision](./deprovision/) flow.
