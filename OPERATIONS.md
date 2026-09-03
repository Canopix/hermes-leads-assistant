# Hermes Leads Assistant — Client Runbook

Operations for `{slug}-leads` profiles on a Hermes server.

## Client provisioning (recommended)

```bash
cd ~/Projects/hermes-leads-assistant
pnpm run setup:client
```

Interactive wizard: business, channels, LLM, Mem0, RAG, knowledge → registers `tenants.json` and provisions the profile.

## Client provisioning (manual)

```bash
cd ~/Projects/hermes-leads-assistant
pnpm run validate:hermes-dist

bash packages/ops/provision-client.sh \
  --slug acme \
  --name "Acme Corp" \
  --telegram-token "BOT_TOKEN" \
  --owner-telegram-id "123456789" \
  --mem0-key "m0-..." \
  --model-provider custom \
  --model "your-model" \
  --model-base-url "https://your-endpoint/v1" \
  --openai-api-key "KEY"
```

This:

1. Validates `packages/hermes-dist/` (no symlinks, no `node_modules`)
2. Installs/updates the distribution in `~/.hermes/profiles/acme-leads/`
3. Writes `.env` (Telegram, Mem0, keys)
4. Customizes `SOUL.md` and `lead_assistant.client_name`
5. Copies optional KB from `examples/{slug}/knowledge/`
6. Installs Python dependencies in the Hermes venv
7. Runs RAG ingest, enables plugins, starts the gateway

## Verify the bot

```bash
acme-leads gateway status
acme-leads sessions list
bash packages/ops/validate-pilot.sh acme-leads
```

### Lead-only mode (no owner)

If you provisioned **without** `owner_telegram_id` (no value entered in the wizard, or a test profile acting as a lead), `validate-pilot.sh` runs in **lead-only mode**:

- Admin tests (`/help` allowed for the owner) are skipped with the message `admin slash tests skipped (lead-only mode)`.
- It still verifies that regular users **cannot** use slash commands (`/help` blocked).

If you see `AssertionError: admin /help must not be blocked` with an empty owner in the profile, that is a bug in an old version of the validation script, not in the bot.

To enable admin later:

```bash
hermes -p acme-leads config set lead_assistant.owner_telegram_id "YOUR_TELEGRAM_ID"
acme-leads gateway restart
bash packages/ops/validate-pilot.sh acme-leads
```

## Update the knowledge base

```bash
acme-leads lead-rag ingest
acme-leads gateway restart
```

Or version it in `examples/acme/knowledge/` and re-provision with `--reingest`.

## Update the template (plugins / owned config)

```bash
pnpm run validate:hermes-dist

# Re-run provisioning (detects an existing profile → profile update)
bash packages/ops/provision-client.sh --slug acme --name "Acme Corp" ...

# Or directly with Hermes:
hermes -p acme-leads profile update acme-leads --yes
hermes profile update acme-leads --force-config   # reset config template
```

**Updated:** `plugins/`, `distribution_owned` files  
**Preserved:** `.env`, `sessions/`, `.lead-capture/`, `.lead-rag/`, the client's `knowledge/`

## Migrate profiles installed from an old source

If a profile was installed from the monorepo root or a `/tmp` bundle before this architecture:

```bash
pnpm run validate:hermes-dist

bash packages/ops/provision-client.sh \
  --slug acme \
  --name "Acme Corp" \
  --telegram-token "$TELEGRAM_BOT_TOKEN" \
  --mem0-key "$MEM0_API_KEY"
```

Or force a re-link of the source:

```bash
hermes profile install "$(pwd)/packages/hermes-dist" --name acme-leads --force --yes
```

Then verify the secrets in `~/.hermes/profiles/acme-leads/.env` (provisioning does not remove existing keys when re-run with the same flags).

## Multi-client monitoring

```bash
hermes profile list
acme-leads gateway status
```

| Resource | Path / ID |
|---------|-----------|
| Profile | `~/.hermes/profiles/{slug}-leads/` |
| Dist source | `packages/hermes-dist/` |
| Mem0 agent_id | `{slug}-leads` |

## Client deprovisioning

```bash
hermes -p acme-leads gateway stop
hermes profile delete acme-leads
```

## WhatsApp via Kapso (opt-in)

```bash
bash packages/ops/provision-client.sh \
  --slug acme \
  --name "Acme Corp" \
  --telegram-token "$TELEGRAM_BOT_TOKEN" \
  --kapso-api-key "$KAPSO_API_KEY" \
  --kapso-phone-number-id "1041695002363992" \
  --owner-whatsapp-id "5491112345678" \
  --kapso-funnel-url "https://api.tuagencia.com/inbound/acme/kapso" \
  --mem0-key "$MEM0_API_KEY"
```

```bash
bash packages/ops/simulate-kapso-message.sh acme-leads --text "Hola"
```
