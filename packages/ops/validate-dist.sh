#!/usr/bin/env bash
# validate-dist.sh — Ensure packages/hermes-dist is safe for hermes profile install/update
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DIST_ROOT="${MONOREPO_ROOT}/packages/hermes-dist"

pass() { echo "✓ $*"; }
fail() { echo "✗ $*"; exit 1; }

echo "==> Validating Hermes distribution: ${DIST_ROOT}"

[[ -d "$DIST_ROOT" ]] || fail "Missing directory: ${DIST_ROOT}"
[[ -f "${DIST_ROOT}/distribution.yaml" ]] || fail "Missing distribution.yaml"
[[ -f "${DIST_ROOT}/config.yaml" ]] || fail "Missing config.yaml"
[[ -f "${DIST_ROOT}/SOUL.md" ]] || fail "Missing SOUL.md"
[[ -f "${DIST_ROOT}/requirements.txt" ]] || fail "Missing requirements.txt"
pass "Core distribution files present"

for plug in lead-scope lead-rag lead-capture lead-documents lead-dashboard lead-verify; do
  [[ -d "${DIST_ROOT}/plugins/${plug}" ]] || fail "Missing plugin: ${plug}"
done
pass "Required plugins present"

SYMLINKS=$(find "$DIST_ROOT" -type l 2>/dev/null | head -5 || true)
if [[ -n "$SYMLINKS" ]]; then
  echo "$SYMLINKS"
  fail "Symlinks are not allowed in Hermes distributions"
fi
pass "No symlinks under hermes-dist"

if grep -q 'node_modules' <<< "$(find "$DIST_ROOT" -type d -name node_modules 2>/dev/null)"; then
  fail "node_modules must not exist under hermes-dist"
fi
pass "No node_modules under hermes-dist"

VERSION=$(grep '^version:' "${DIST_ROOT}/distribution.yaml" | awk '{print $2}' | tr -d '"')
[[ -n "$VERSION" ]] || fail "Could not read version from distribution.yaml"
pass "Distribution version: ${VERSION}"

echo ""
echo "Hermes distribution is valid."
