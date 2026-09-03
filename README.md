# Hermes Leads Assistant

Multi-tenant AI assistant platform that turns Telegram and WhatsApp inquiries
into captured, tracked leads — one isolated bot per client business.

Each client business gets its own Hermes profile with a public bot. The bot
answers using the client's knowledge base, extracts lead details from the
conversation, and hands them to a human closer — all visible in a web portal.

[![CI](https://github.com/canopix/hermes-leads-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/canopix/hermes-leads-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![X](https://img.shields.io/badge/X-%40emanuel__build-1DA1F2?logo=x&logoColor=white)](https://x.com/emanuel_build)

## How it works

1. **A customer messages the bot** on Telegram (WhatsApp via Kapso optional).
2. **The bot answers from the client's knowledge base** (RAG) and follows the
   behavior defined in the tenant's `SOUL.md` — including what it must *not*
   do (no pricing promises, no fake availability).
3. **The bot captures the lead** (name, interest, budget, …) into per-tenant
   SQLite, with rate limiting and tenant isolation enforced by plugins.
4. **A human closes the sale.** The bot informs; the advisor negotiates. The
   portal shows the lead, the full conversation, and the kanban pipeline.

## Architecture

```
hermes-leads-assistant/
├── apps/
│   ├── portal/            # Client portal (Next.js, Better Auth, SQLite)
│   ├── web/               # Marketing site (Astro)
│   └── docs/              # Documentation site (Starlight)
├── packages/
│   ├── hermes-dist/       # Hermes distribution: plugins + templates (install/update source)
│   ├── ops/               # Operator tooling: provision, setup wizard, validation
│   └── shared/            # Shared TS types + JSON schemas (@hermes-leads/shared)
├── cli/                   # leadai — operator CLI (Python)
├── examples/
│   └── canova-cars/       # Example tenant: SOUL, knowledge base, extraction hints
├── tests/                 # Python test suite
├── deploy.sh              # VPS bootstrap: Nginx + HTTPS + backups
└── tenants.example.json   # Tenant registry example (real registry lives in the portal DB)
```

**Rule:** Node code (`apps/`) is never a Hermes source. Runtime profiles live
outside the repo in `~/.hermes/profiles/{slug}-leads/` — one per tenant,
fully isolated (config, sessions, DB, knowledge).

### Plugins (`packages/hermes-dist/plugins/`)

| Plugin          | Purpose                                        |
|-----------------|------------------------------------------------|
| `lead-scope`    | Tenant isolation, allowlists, rate limiting    |
| `lead-rag`      | Knowledge base retrieval (embeddings + FTS)    |
| `lead-capture`  | Lead extraction, SQLite persistence, migrations|
| `lead-documents`| Document management per tenant                 |
| `lead-verify`   | Data validation for captured leads             |
| `lead-catalog`  | Structured product catalog (SQLite, autos vertical) |
| `lead-dashboard`| Kanban and stats dashboard                     |

## Quickstart

Requirements: Node.js 18+, Python 3.10+, pnpm, and
[Hermes Agent](https://hermes.example.com) installed.

```bash
pnpm install
pnpm run validate:hermes-dist

pnpm run dev:portal    # http://localhost:3000
pnpm run dev:docs      # documentation site
```

Operator CLI:

```bash
cd cli && pip install -r requirements.txt
python leadai.py --help
```

## Provision your first bot

The guided way:

```bash
pnpm run setup:client
```

The wizard walks you through: business name, slug, Telegram token, owner ID,
LLM provider, Mem0, RAG, and knowledge base — then runs the provision.

The manual way (idempotent — safe to re-run over an existing profile; it
merges env vars, never duplicates allowlist entries, and preserves an
existing `KAPSO_WEBHOOK_SECRET`):

```bash
pnpm run validate:hermes-dist

python cli/leadai.py tenants add --slug my-business --name "My Business"

# Pass secrets via env vars (safer: they don't show in `ps` / /proc).
# Flags take precedence over env vars.
LEADAI_TELEGRAM_TOKEN="BOT_TOKEN" \
LEADAI_MEM0_KEY="MEM0_KEY" \
  bash packages/ops/provision-client.sh \
    --slug my-business \
    --name "My Business"

python cli/leadai.py bot-status my-business
```

Tip: copy `examples/canova-cars/` to `examples/{your-slug}/` to give your bot
a SOUL, knowledge base, and extraction hints from day one.

## Environment variables

- **Portal**: copy `apps/portal/.env.example` → `apps/portal/.env`.
- **Monorepo / ops**: see `.env.EXAMPLE` at the repo root.
- **Bot credentials**: generated at `~/.hermes/profiles/{slug}-leads/.env`
  during provisioning (see `packages/hermes-dist/.env.EXAMPLE`).

## Database migrations

Each tenant's SQLite DB (`~/.hermes/profiles/{slug}-leads/.lead-capture/leads.db`)
uses a versioned migration runner backed by a `schema_migrations` table. It is
safe for fresh DBs (applies all in order), legacy DBs (reconciles the schema),
and re-runs (skips applied versions).

To add a migration, append an entry to `_MIGRATIONS` in
`packages/hermes-dist/plugins/lead-capture/db.py`. Never edit or reorder
existing ones — that breaks the version contract for already-migrated tenants.
Details: [docs → data → migrations](./apps/docs/src/content/docs/data/migrations.md).

## Development

```bash
pnpm run build
pnpm run lint          # ESLint (portal + shared)
pnpm run type-check
pnpm test              # portal tests (vitest), incl. the Python↔TS contract test
pnpm run test:cli      # Python CLI tests
ruff check cli packages/hermes-dist tests
```

Pre-commit hooks (Ruff, Prettier, Shellcheck, ESLint, type-check, and a
secret-forbid guard) run via `.pre-commit-config.yaml`. CI enforces the same
checks on every push and PR.

## Health checks

- `GET /api/health` — basic public health (no auth).
- `GET /api/health/tenants` — multi-tenant probe for external watchdogs
  (requires `Authorization: Bearer $WATCHDOG_TOKEN`). Returns aggregated
  status plus an online flag per tenant.
- `GET /api/admin/health` — detailed per-tenant metrics (super admin only).

Set `WATCHDOG_TOKEN` in the portal `.env` to enable the external probe.

## Deploy to a VPS

```bash
sudo LEADAI_DOMAIN=leads.example.com \
     LEADAI_REPO_URL=https://github.com/you/hermes-leads-assistant.git \
     ./deploy.sh
```

Configures a fresh Ubuntu/Debian box: Nginx, HTTPS (Let's Encrypt), the
portal, and backup targets. Safe to re-run.

## Documentation

The full documentation lives in [`apps/docs`](./apps/docs) (Starlight site —
run `pnpm run dev:docs` to browse it locally):

- **Architecture** — message flow, multi-tenancy model
- **Plugins** — each plugin's config and internals
- **Runbooks** — provision, debug, deprovision, backups
- **Data** — schema contracts, migrations, the Python↔TS contract test
- **ADRs** — why Hermes profiles, why SQLite, why WAL

## Security

Found a vulnerability? Please report it privately — see
[SECURITY.md](./SECURITY.md). Never commit `.env` files or real tokens.

## License

[MIT](./LICENSE) © Emanuel Canova
