# Hermes Distribution

This directory is the **only** source for `hermes profile install` and `hermes profile update`.

It contains plugins, templates, and metadata declared in `distribution.yaml`. It must stay free of Node.js artifacts (`node_modules`, symlinks).

## Install / update a client profile

From the monorepo root:

```bash
bash packages/ops/provision-client.sh --slug acme --name "Acme Corp" ...
```

Or directly with Hermes:

```bash
hermes profile install "$(pwd)/packages/hermes-dist" --name acme-leads --yes
hermes profile update acme-leads --yes
```

## Validate before provisioning

```bash
pnpm run validate:hermes-dist
```
