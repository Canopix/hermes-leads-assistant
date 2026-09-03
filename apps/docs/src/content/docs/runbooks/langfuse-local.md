---
title: Local Langfuse
description: Self-hosted LLM observability (ops-only) — one project, same keys, filter by tenant.
template: doc
---

# Runbook: Local Langfuse

**Opt-in** LLM observability stack for **you (the operator)**. It lives in
`packages/ops/langfuse/` and does **not** start with the portal.

Tenants **do not** see Langfuse or costs in the portal.

## Model A — shared project

| What | How |
|---|---|
| Langfuse projects | **One** |
| API keys (`pk` / `sk`) | **Same** across all profiles |
| Who views the UI | Operator only |
| Filter by tenant | `HERMES_LANGFUSE_ENV=<slug>` → Environment in Langfuse |

It lets you see, per conversation (`session_id`):

- Hermes turns (`"Hermes turn"`)
- Each LLM call (tokens, estimated cost, model, latency)
- Tool calls
- `lead-rag` embeddings (auxiliary instrumentation)

## Prerequisites

- Docker + Compose v2
- ~4 GB free RAM (ClickHouse)
- Port **3100** free (UI; the portal usually uses `:3000`)

## 1. Start Langfuse

```bash
cd packages/ops/langfuse
cp .env.example .env
# Generate secrets (required outside a throwaway):
#   openssl rand -base64 32
#   openssl rand -hex 32   # ENCRYPTION_KEY = 64 hex chars
docker compose up -d
./smoke-check.sh
```

UI: [http://localhost:3100](http://localhost:3100)

Log in with `LANGFUSE_INIT_USER_*` from the `.env`.

Shared API keys (ops):

- `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `SECRET_KEY` in the compose `.env`, or
- Project → Settings → API Keys in the UI

To reuse them in provision / sync:

```bash
export LEADAI_LANGFUSE_PUBLIC_KEY="$(grep '^LANGFUSE_INIT_PROJECT_PUBLIC_KEY=' packages/ops/langfuse/.env | cut -d= -f2-)"
export LEADAI_LANGFUSE_SECRET_KEY="$(grep '^LANGFUSE_INIT_PROJECT_SECRET_KEY=' packages/ops/langfuse/.env | cut -d= -f2-)"
export LEADAI_LANGFUSE_BASE_URL=http://localhost:3100
```

## 2. Wire all profiles

```bash
cd packages/ops/langfuse
./sync-profiles.sh
```

That puts the **same** keys in each `*-leads`, sets `HERMES_LANGFUSE_ENV=<slug>`,
enables `observability/langfuse`, and installs the SDK.

New profiles via provision: if `LEADAI_LANGFUSE_PUBLIC_KEY` + `SECRET_KEY`
are in the environment, they get wired automatically and `HERMES_LANGFUSE_ENV` defaults to `--slug`.

```bash
LEADAI_LANGFUSE_PUBLIC_KEY="pk-lf-..." \
LEADAI_LANGFUSE_SECRET_KEY="sk-lf-..." \
  bash packages/ops/provision-client.sh --slug acme --name "Acme Corp"
```

## 3. Smoke test

1. UI up: `./smoke-check.sh`
2. Profiles synced: `./sync-profiles.sh`
3. Portal → **Playground** (super_admin) → pick a tenant → send a message
4. Langfuse → Traces → filter **Environment** = tenant slug (e.g. `canova-cars`)
5. Open the **"Hermes turn"**: tokens / cost / tools

A Telegram/WhatsApp DM to the tenant's bot also works.

Extra filter: session = Hermes `session_id` (the one from the playground / lead).

## Cost coverage

| Call | Covered by |
|---|---|
| Main LLM call of the turn | `observability/langfuse` plugin |
| Tools in the agent loop | Same plugin |
| Auxiliary `call_llm` (extractor, classifier, verifier) | `langfuse_aux.traced_call_llm` — `lead_*` generations with the same `session_id` |
| `lead-rag` embeddings | `observe_embedding` → `lead_rag_embeddings` generation |
| HTTP rerank | Not yet |

In Langfuse: filter by the playground/DM **Session**. You'll see the
`Hermes turn` plus auxiliary generations (`lead_verifier`, `lead_extractor`, …)
with their own latency — that's where you see if nan eats up the time in verify.

## PII and security

Traces include prompts → lead data. Compose binds to `127.0.0.1:3100`. Do
not expose the port. Do not give Langfuse keys or access to tenant users.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Plugin doesn't trace / empty traces | SDK: you need `langfuse>=4.14` (`set_trace_io`). Run `./sync-profiles.sh` or `pip install 'langfuse>=4.14,<5'` in the Hermes venv. In logs: `finish trace failed` = old version |
| Silent fail-open | `HERMES_LANGFUSE_DEBUG=true` in the profile `.env` |
| Can't filter by tenant | `HERMES_LANGFUSE_ENV` must be the **slug**, not `local` |
| Chat very slow | Usually `lead-verify` / auxiliaries (another LLM call), not Langfuse. Check `agent.log` timestamps |
| Embeddings 403 | Embeddings key/base URL; doesn't block chat or Langfuse |
| Invalid UI | Valid INIT email (`admin@example.com`); `ENCRYPTION_KEY` 64 hex |
| Port / compose | See the README in `packages/ops/langfuse/` |

## Ops

```bash
cd packages/ops/langfuse
docker compose up -d
./sync-profiles.sh
./smoke-check.sh
docker compose logs -f langfuse-web
docker compose down
```

Future design (portal, ops/super_admin only): see
[Langfuse in the portal](../ops/langfuse-portal/).
