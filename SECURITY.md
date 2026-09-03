# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a vulnerability

This project handles third-party credentials (Telegram bot tokens, LLM API keys,
WhatsApp provider keys), so security reports matter.

**Please do not open a public GitHub issue for security problems.**

Instead, use one of these channels:

1. **GitHub Security Advisories** (preferred): go to the repository's
   *Security* tab → *Report a vulnerability*.
2. **Email**: contact the maintainer directly (see the GitHub profile of
   [@canopix](https://github.com/canopix)).

Include as much of the following as you can:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected versions / commit hash.
- Any suggested fix (optional).

## What to expect

- Acknowledgment within 72 hours.
- An assessment and fix timeline within 7 days.
- A coordinated release and public disclosure once a fix ships.

## Scope

In scope:

- Credential leakage paths (env handling, provisioning scripts, logs).
- Multi-tenant isolation (one tenant reading another tenant's data).
- The portal auth layer (Better Auth routes, admin endpoints).
- The plugin sandbox (`packages/hermes-dist/plugins/`), especially
  `lead-scope` (rate limiting / security) and `lead-capture` (data extraction).
- Deploy tooling (`deploy.sh`, `packages/ops/`).

Out of scope:

- Vulnerabilities in upstream dependencies — report those upstream, but you
  may also notify us if the impact on this project is severe.
- Self-hosted misconfigurations that are already documented as unsupported
  (e.g. exposing the portal directly without TLS).

## Best practices for operators

- Never commit `.env` files — use the provided `.env.EXAMPLE` templates.
- Rotate bot tokens and API keys if they ever appear in logs or shared output.
- Run `pre-commit` hooks locally; CI blocks secrets from entering the repo.
