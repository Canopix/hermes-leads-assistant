# Langfuse local (opt-in, ops-only)

Self-hosted [Langfuse](https://langfuse.com) for **operator** LLM observability.
UI on **http://localhost:3100** (avoids clashing with the portal on `:3000`).

## Model A — shared project

- **One** Langfuse project, **same** API keys on every Hermes profile.
- Tenants **never** see Langfuse (no portal UI for them).
- Per-tenant filter: `HERMES_LANGFUSE_ENV=<slug>` → Langfuse **Environment** = tenant slug.

## Prerequisites

- Docker + Compose v2
- ~4 GB RAM free (ClickHouse is the heavy piece)

## Quickstart

```bash
cd packages/ops/langfuse
cp .env.example .env

# Replace changeme secrets (required for anything beyond a throwaway local box):
#   openssl rand -base64 32
#   openssl rand -hex 32   # ENCRYPTION_KEY — 64 hex chars

docker compose up -d
./smoke-check.sh
```

Open http://localhost:3100 and sign in with `LANGFUSE_INIT_USER_*` from `.env`.

Use a real-looking init email (`admin@example.com`) — `@localhost` is rejected by Langfuse validation.

API keys (shared across all tenants) come from:

- `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `LANGFUSE_INIT_PROJECT_SECRET_KEY` in `.env`, or
- Project Settings → API Keys in the UI

## Wire all existing profiles

```bash
cd packages/ops/langfuse
./sync-profiles.sh          # reads INIT keys from ./.env
# or:
LEADAI_LANGFUSE_PUBLIC_KEY=pk-lf-... \
LEADAI_LANGFUSE_SECRET_KEY=sk-lf-... \
  ./sync-profiles.sh
```

This merges the same keys into every `~/.hermes/profiles/*-leads/.env`, sets
`HERMES_LANGFUSE_ENV=<slug>`, enables `observability/langfuse`, and installs the SDK.

## Point a single profile (manual)

```bash
HERMES_LANGFUSE_PUBLIC_KEY=pk-lf-local-hermes-leads
HERMES_LANGFUSE_SECRET_KEY=sk-lf-...
HERMES_LANGFUSE_BASE_URL=http://localhost:3100
HERMES_LANGFUSE_ENV=canova-cars          # tenant slug — not "local"
```

Or via provision (keys shared via `LEADAI_LANGFUSE_*`; ENV defaults to `--slug`):

```bash
LEADAI_LANGFUSE_PUBLIC_KEY=pk-lf-... \
LEADAI_LANGFUSE_SECRET_KEY=sk-lf-... \
  bash packages/ops/provision-client.sh --slug acme --name "Acme Corp"
```

## Ops commands

```bash
docker compose up -d
docker compose ps
docker compose logs -f langfuse-web
docker compose down
./sync-profiles.sh --dry-run
./smoke-check.sh
```

## Notes

- Opt-in tooling — does **not** start with the portal.
- Traces may contain lead PII. Keep bound to localhost.
- Hermes plugin is fail-open: missing keys/SDK never break the agent loop.
- Full runbook: docs → Runbooks → Langfuse local.
