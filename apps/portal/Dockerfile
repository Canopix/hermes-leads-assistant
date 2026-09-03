# syntax=docker/dockerfile:1.7
#
# Portal (Next.js standalone) — production image.
#
# Multi-stage build:
#   1. deps   — install only production deps with pnpm, leveraging the lockfile
#   2. build  — install all deps + build @lead-ai/shared + build the Next app
#   3. run    — copy only .next/standalone + .next/static + public + system deps
#
# Resulting image is ~150-250 MB and does NOT include devDependencies, source
# maps, or the toolchain. It expects to mount the Hermes profiles directory
# (HERMES_PROFILES_DIR) at runtime — typically via a host bind mount or a
# named volume shared with the Hermes gateway containers.
#
# Build:
#   docker build -t lead-ai-portal:latest -f apps/portal/Dockerfile .
# Run (assumes a host path with the Hermes profiles):
#   docker run --rm -p 3000:3000 \
#     -v ~/.hermes:/home/leadai/.hermes \
#     -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
#     -e HERMES_PROFILES_DIR=/home/leadai/.hermes/profiles \
#     -e WATCHDOG_TOKEN=$(openssl rand -hex 32) \
#     lead-ai-portal:latest

ARG NODE_VERSION=20-bookworm-slim

# ---- 1. deps ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# Copy lockfile + workspace manifests first for maximal layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/portal/package.json apps/portal/package.json
COPY packages/shared/package.json packages/shared/package.json

# better-sqlite3 needs build tools + python to compile its native addon.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    apt-get update && apt-get install -y --no-install-recommends \
        python3=3.11.2-1+b1 \
        build-essential=12.9 \
        ca-certificates=20230311 \
    && rm -rf /var/lib/apt/lists/* \
    && pnpm install --frozen-lockfile --filter=portal... --filter=@lead-ai/shared

# ---- 2. build ---------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/portal/node_modules ./apps/portal/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/portal ./apps/portal
COPY packages/shared ./packages/shared

# Build shared types first, then the Next app.
RUN pnpm --filter=@lead-ai/shared build \
    && pnpm --filter=portal build

# ---- 3. run -----------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS run
WORKDIR /app

# Create a non-root user that matches the UID/GID expected on the host (leadai).
# Using a fixed UID lets bind-mounted ~/.hermes files be readable+writable.
RUN groupadd --system --gid 1001 leadai \
    && useradd  --system --uid 1001 --gid leadai \
                --home-dir /home/leadai --create-home \
                --shell /usr/sbin/nologin leadai

# Copy only the standalone server output + static assets + public dir.
# Next's `output: standalone` produces .next/standalone/server.js plus a
# node_modules trimmed to what the server actually imports.
COPY --from=build --chown=leadai:leadai /app/apps/portal/.next/standalone ./
COPY --from=build --chown=leadai:leadai /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build --chown=leadai:leadai /app/apps/portal/public ./apps/portal/public

USER leadai
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default profiles dir inside the container; override via bind mount.
ENV HERMES_PROFILES_DIR=/home/leadai/.hermes/profiles

EXPOSE 3000

# Next standalone server entrypoint — relative to /app.
CMD ["node", "apps/portal/server.js"]
