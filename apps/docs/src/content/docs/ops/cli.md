---
title: leadai CLI
description: CLI commands for tenant and bot management.
template: doc
---

# `leadai` CLI

**File:** `cli/leadai.py` — Python Typer CLI (559 lines).

A wrapper around the `hermes` binary + management of the `tenants.json` registry.

## Setup

```bash
cd cli
pip install -r requirements.txt   # typer, rich
python leadai.py --help
```

## Commands

### `tenants` group

| Command | What it does |
|---|---|
| `tenants list` | Rich table with all registry tenants (slug, name, status, channels, created_at) |
| `tenants add --slug X --name "Y"` | Adds an entry to the registry. **Does not provision** — metadata only |
| `tenants show SLUG` | Prints metadata + checks if the profile dir exists on disk |
| `tenants remove SLUG --force` | Removes from the registry. **Does not deprovision** |

### `provision` group

| Command | What it does |
|---|---|
| `provision create SLUG` | Validates the slug is in the registry, then execs `provision-client.sh`. Secrets via `LEADAI_*` env vars |
| `provision destroy SLUG` | Deprovisions: stop bot → tar + openssl encrypt → shred → mark `suspended`. See the [deprovision runbook](../../runbooks/deprovision/) |

### `bot` group

All assume the profile is `{slug}-leads`.

| Command | Hermes equivalent |
|---|---|
| `bot start SLUG` | `hermes gateway start --profile {slug}-leads` |
| `bot stop SLUG` | `hermes gateway stop --profile {slug}-leads` |
| `bot restart SLUG` | sequential stop + start |
| `bot status [SLUG]` | Iterates tenants and shows a RUNNING/STOPPED table |
| `bot logs SLUG [-n 50]` | Tails the most recent log in `~/.hermes/profiles/{slug}-leads/logs/` |

### `monitor` group

| Command | What it does |
|---|---|
| `monitor check [SLUG]` | Same as `bot status` + a summary line `X running, Y stopped` |

> The `monitor watch` command **does not exist** (stub). This is why `deploy.sh` deliberately does not create the old `leadai-cli.service` systemd unit.

## Helper functions

- `load_tenants()` / `save_tenants()` / `get_tenant(slug)` — JSON read/write on `tenants.json`. Defaults to `{"tenants": []}` if missing.

## Path resolution

```python
TENANTS_FILE = Path(__file__).parent.parent / "tenants.json"
HERMES_PROFILES_DIR = Path.home() / ".hermes" / "profiles"
```

## Examples

### Full client onboarding

```bash
# 1. Register
python cli/leadai.py tenants add \
  --slug acme-corp \
  --name "Acme Corp"

# 2. Provision (secrets via env, not argv)
LEADAI_TELEGRAM_TOKEN="123:abc" \
LEADAI_MEM0_KEY="mem0-xxx" \
LEADAI_OPENAI_API_KEY="sk-xxx" \
  python cli/leadai.py provision create acme-corp

# 3. Verify
python cli/leadai.py bot status acme-corp
```

### Debug a down bot

```bash
python cli/leadai.py bot status acme-corp    # stopped?
python cli/leadai.py bot logs acme-corp -n 100
python cli/leadai.py bot restart acme-corp
```

### See all tenants

```bash
python cli/leadai.py tenants list
python cli/leadai.py bot status
```

## Secrets security

The CLI passes secrets to `provision-client.sh` via **env vars** (`LEADAI_*`), not argv:

```python
env = os.environ.copy()
env["LEADAI_TELEGRAM_TOKEN"] = telegram_token
env["LEADAI_MEM0_KEY"] = mem0_key
subprocess.run(["bash", "provision-client.sh", ...], env=env)
```

This keeps them out of `ps`, `/proc/<pid>/cmdline`, and shell history.

> **Note:** the wizard (`setup-wizard.py`) passes secrets via argv — less secure. Prefer the CLI in shared environments.
