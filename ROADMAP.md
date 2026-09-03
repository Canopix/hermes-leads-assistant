# Roadmap

Hermes Leads Assistant is under active development. This roadmap reflects the
current priorities — it is a living document, not a promise.

## Now

- [ ] Public release: clean git history, English documentation, contribution
      guidelines.
- [ ] One ready-to-use example tenant (`examples/canova-cars/`) documented
      end-to-end (provision → bot answers → lead lands in the portal).
- [ ] Improve first-run experience: `pnpm run setup:client` wizard covers the
      full path with zero docs reading.

## Next

- [ ] Rename the operator CLI from `leadai` to `hermes-leads` (keeps backward
      compatibility via alias).
- [ ] Unify the `LEADAI_*` environment variable prefix and the SOUL.md title
      format with the product name (requires a migration for existing
      profiles).
- [ ] Move the tenant registry (`tenants.json`) fully into the portal DB and
      deprecate the file-based flow.
- [ ] WhatsApp (Kapso) provisioning covered by the setup wizard by default,
      not as a manual opt-in step.
- [ ] Expand contract tests between Python plugins and the TypeScript portal
      (currently lead schema only).

## Later

- [ ] Pluggable verticals beyond autos (the catalog seed already hints at
      `autos | inmobiliaria`): travel, clinics, real estate templates.
- [ ] Multi-language bot responses per tenant.
- [ ] Managed hosting story (single-tenant Docker image per profile).
- [ ] Dashboard: funnel analytics per channel (Telegram vs WhatsApp).
- [ ] Optional Langfuse tracing bundle shipped by default with sensible
      sampling.

## Done

- [x] Multi-tenant architecture with isolated Hermes profiles per client.
- [x] Lead capture, RAG knowledge, rate limiting and dashboard plugins.
- [x] Portal with auth, lead kanban, per-tenant config (SOUL, knowledge,
      extraction hints, platforms).
- [x] Versioned SQLite schema migrations (safe re-runs, legacy reconciliation).
- [x] CI: lint, type-check, tests, shellcheck, secret-forbid pre-commit hooks.
