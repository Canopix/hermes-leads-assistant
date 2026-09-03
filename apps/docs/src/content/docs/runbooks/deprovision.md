---
title: Deprovision / archive
description: Take a tenant offline while preserving its data.
template: doc
---

# Runbook: Deprovision / archive

Take a tenant offline: stop the bot, archive the whole profile (encrypted), and mark it as suspended.

## Warnings

- **It is destructive.** The profile is deleted from disk. Only the encrypted archive survives.
- The archive password is returned **once only** — store it somewhere safe.
- The bot is stopped first so it doesn't capture leads during the archive.

## Via CLI

```bash
python cli/leadai.py provision destroy acme-corp
```

Internal steps:

1. `bot_stop(slug)` — stops the gateway.
2. `tar -czf` of the profile dir.
3. `openssl enc -aes-256-cbc -pbkdf2 -salt` to encrypt.
4. `shred -u` of the plaintext tar.
5. `chmod 600` of the `.enc`.
6. Marks the tenant `status=suspended` + `deprovisioned_at` in the registry. **Does not delete** the entry.

Options:

- `--archive-pass "mypass"` or `LEADAI_ARCHIVE_PASS` — custom password (default: auto-generated via `secrets.token_urlsafe(24)`).
- `--keep-profile` — archive only, doesn't delete the profile.
- `--no-archive` — no archive, deletes only.
- Default archive dir: `~/backups`.

## Via Portal (super_admin)

1. Log in to the portal as super_admin.
2. `/admin/tenants/{slug}` → "Deprovision".
3. **Two-step confirm**: type the slug in the input.
4. Click confirm.

The `/api/admin/tenants/[slug]/deprovision` route requires:

- super_admin
- `confirm` in body equal to the slug
- Rate-limited 5/min
- Writes the `tenant.deprovision` audit **before** deleting
- Returns the password **in the response body** — copy and store it

Same flow as the CLI (stop → tar → encrypt → shred → wipe → mark suspended).

## Where the archive lives

```
~/backups/{slug}-leads-{timestamp}.tar.gz.enc
```

(or `/var/backups/lead-ai/` on deploy, depending on configuration).

## Restore from archive

```bash
# 1. Decrypt
openssl enc -d -aes-256-cbc -pbkdf2 -in acme-corp-leads-2026-06-24.tar.gz.enc \
  -out acme-corp-leads.tar.gz
# (it prompts for the password)

# 2. Extract to the profiles dir
tar -xzf acme-corp-leads.tar.gz -C ~/.hermes/profiles/

# 3. Reactivate the tenant in the registry
python cli/leadai.py tenants show acme-corp   # verify it's still there
# (status=suspended → you need to edit it by hand or re-add)

# 4. Restart bot
python cli/leadai.py bot start acme-corp

# 5. Shred the plaintext immediately
shred -u acme-corp-leads.tar.gz
```

## Hard delete (irreversible)

`provision destroy` does not delete the registry entry. To delete it:

```bash
python cli/leadai.py tenants remove acme-corp --force
```

In the portal, `/api/admin/tenants/[slug]` DELETE (super_admin) removes the row from the `tenants` table and cascades `tenant_members` (FK). `audit_log` is **not** deleted (no FK cascade — outlives entities by design).

> **If you later want to restore** from the archive, you'll have to re-create the tenant.

## Post-deprovision verification

```bash
# Profile should not exist
ls ~/.hermes/profiles/acme-corp-leads/  # No such file or directory

# Bot should not be running
python cli/leadai.py bot status | grep acme-corp  # empty

# Registry should have the tenant as suspended
python cli/leadai.py tenants show acme-corp
# status: suspended, deprovisioned_at: 2026-06-24T...

# Archive should exist
ls -la ~/backups/acme-corp-leads-*.tar.gz.enc
```
