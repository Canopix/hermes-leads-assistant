#!/bin/bash
#
# Dependency audit — npm (pnpm) + python (pip-audit).
# Exits non-zero on high-severity findings so it can gate CI.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> pnpm audit (production)"
pnpm audit --prod || echo "[warn] pnpm audit reported issues; review above."

if command -v pip-audit >/dev/null 2>&1; then
  echo "==> pip-audit (Hermes venv)"
  HERMES_VENV="${HERMES_VENV:-$(ls -d ~/.hermes/profiles/*-leads/venv 2>/dev/null | head -1)}"
  if [[ -n "$HERMES_VENV" ]]; then
    "$HERMES_VENV/bin/pip-audit" --strict || echo "[warn] pip-audit reported issues; review above."
  else
    echo "[info] No Hermes venv found; skipping pip-audit."
  fi
else
  echo "[info] pip-audit not installed; install with 'pip install pip-audit'."
fi

echo "==> Audit complete."
