#!/bin/bash
#
# Hermes Leads Assistant — launch acceptance smoke test.
#
# Boots the portal, creates two tenants + two users (one per tenant), and
# asserts the production-readiness properties from the revision plan:
#
#   1. Anonymous visit to /leads → redirected to /login
#   2. User in tenant A reading tenant B's leads → 403
#   3. Config write appears in /admin/audit
#   4. Suspended tenant → its users cannot reach /api/leads (403)
#   5. Super-admin can list all tenants via /api/admin/tenants
#
# Idempotent: re-runnable. Cleans up previous test tenants if found.
#
# Environment:
#   PORTAL_PORT  default 3100 (avoids clobbering dev :3000)
#   PORTAL_DB    override the auth DB path (default: a temp file)
#
set -euo pipefail

PORT="${PORTAL_PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"
PORTAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/apps/portal"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Use a throwaway auth DB and throwaway profiles dir so this never touches
# anything real. We also pre-create the profile directories the test tenants
# will point at, because config writes (SOUL.md, etc.) refuse to write if the
# profile dir doesn't physically exist (defense against stale tenant rows).
export PORTAL_AUTH_DB="${PORTAL_AUTH_DB:-$TMP_DIR/auth.sqlite}"
export HERMES_PROFILES_DIR="$TMP_DIR/profiles"
mkdir -p "$HERMES_PROFILES_DIR/smoke-a-leads/knowledge" \
         "$HERMES_PROFILES_DIR/smoke-b-leads/knowledge"
printf '# placeholder\n' > "$HERMES_PROFILES_DIR/smoke-a-leads/SOUL.md"
printf '# placeholder\n' > "$HERMES_PROFILES_DIR/smoke-b-leads/SOUL.md"
printf 'channels: []\n' > "$HERMES_PROFILES_DIR/smoke-a-leads/config.yaml"
printf 'channels: []\n' > "$HERMES_PROFILES_DIR/smoke-b-leads/config.yaml"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-test-secret-$(openssl rand -hex 16)}"
export BETTER_AUTH_URL="$BASE"
export NODE_ENV="${NODE_ENV:-test}"

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------

info()  { printf '\033[0;32m[INFO]\033[0m %s\n' "$*"; }
ok()    { printf '\033[0;32m[  OK]\033[0m %s\n' "$*"; }
fail()  { printf '\033[0;31m[FAIL]\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing dep: $1" >&2; exit 2; }
}

require curl
require node

COOKIE_JAR_A="$TMP_DIR/a.jar"
COOKIE_JAR_B="$TMP_DIR/b.jar"
COOKIE_JAR_ADMIN="$TMP_DIR/admin.jar"
rm -f "$COOKIE_JAR_A" "$COOKIE_JAR_B" "$COOKIE_JAR_ADMIN"

# ----------------------------------------------------------------------------
# Boot the portal
# ----------------------------------------------------------------------------

info "Booting portal on port $PORT (auth DB: $PORTAL_AUTH_DB)"
PORTAL_LOG="$TMP_DIR/portal.log"
cd "$PORTAL_DIR"
PORT="$PORT" node .next/standalone/apps/portal/server.js \
  >"$PORTAL_LOG" 2>&1 &
PORTAL_PID=$!
cd - >/dev/null

# Wait for the server to come up.
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE/api/health"; then break; fi
  sleep 1
done

if ! curl -sf -o /dev/null "$BASE/api/health"; then
  echo "portal did not start; log:" >&2
  cat "$PORTAL_LOG" >&2
  exit 1
fi
info "Portal up (pid $PORTAL_PID)."

# shellcheck disable=SC2329  # invoked via trap below
cleanup() {
  info "Shutting down portal (pid $PORTAL_PID)"
  kill "$PORTAL_PID" 2>/dev/null || true
  wait "$PORTAL_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ----------------------------------------------------------------------------
# Seed: super admin + two tenants + two users
# ----------------------------------------------------------------------------

info "Seeding users + tenants via Better Auth API + admin endpoints"

admin_email="admin-smoke@example.test"
admin_pass="$(openssl rand -base64 16 | tr -d '=+/')"
a_email="a-smoke@example.test"
a_pass="$(openssl rand -base64 16 | tr -d '=+/')"
b_email="b-smoke@example.test"
b_pass="$(openssl rand -base64 16 | tr -d '=+/')"

signup() {
  local email="$1" pass="$2" name="$3"
  local body
  body=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/auth/sign-up/email" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pass\",\"name\":\"$name\"}")
  local code="${body##*$'\n'}"
  if [[ "$code" != "20"* ]]; then
    echo "signup $email failed (HTTP $code): $body" >&2
    return 1
  fi
}

signup "$admin_email" "$admin_pass" "Smoke Admin"
signup "$a_email"     "$a_pass"     "Smoke A"
signup "$b_email"     "$b_pass"     "Smoke B"

# Promote admin to super_admin directly in the DB (mirrors create-super-admin.ts).
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 CLI required for smoke test" >&2
  exit 2
fi
sqlite3 "$PORTAL_AUTH_DB" "UPDATE user SET role = 'super_admin' WHERE email = '$admin_email';"
info "Promoted $admin_email to super_admin."

sign_in() {
  local email="$1" pass="$2" jar="$3"
  local body
  body=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' \
    -c "$jar" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}")
  local code="${body##*$'\n'}"
  if [[ "$code" != "20"* ]]; then
    echo "sign_in $email failed (HTTP $code): $body" >&2
    return 1
  fi
}

sign_in "$admin_email" "$admin_pass" "$COOKIE_JAR_ADMIN"
sign_in "$a_email"     "$a_pass"     "$COOKIE_JAR_A"
sign_in "$b_email"     "$b_pass"     "$COOKIE_JAR_B"

create_tenant() {
  local slug="$1" name="$2"
  curl -sf -X POST "$BASE/api/admin/tenants" \
    -H 'Content-Type: application/json' \
    -b "$COOKIE_JAR_ADMIN" \
    -d "{\"slug\":\"$slug\",\"name\":\"$name\"}" >/dev/null
}

create_tenant "smoke-a" "Smoke Tenant A"
create_tenant "smoke-b" "Smoke Tenant B"

# Get user IDs.
users_json=$(curl -s -w '\n%{http_code}' "$BASE/api/admin/users" -b "$COOKIE_JAR_ADMIN")
users_code="${users_json##*$'\n'}"
if [[ "$users_code" != "200" ]]; then
  echo "GET /api/admin/users failed (HTTP $users_code): $users_json" >&2
  exit 1
fi
USER_A_ID=$(echo "${users_json%$'\n'*}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).users.find(u=>u.email==="'$a_email'").id')
USER_B_ID=$(echo "${users_json%$'\n'*}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).users.find(u=>u.email==="'$b_email'").id')

add_member() {
  local slug="$1" user_id="$2" role="$3"
  curl -sf -X POST "$BASE/api/admin/tenants/$slug/members" \
    -H 'Content-Type: application/json' \
    -b "$COOKIE_JAR_ADMIN" \
    -d "{\"user_id\":\"$user_id\",\"role\":\"$role\"}" >/dev/null
}

add_member "smoke-a" "$USER_A_ID" "owner"
add_member "smoke-b" "$USER_B_ID" "owner"

info "Seed complete."

# ----------------------------------------------------------------------------
# Test 1: anonymous → /login
# ----------------------------------------------------------------------------

anon_status=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' \
  --max-redirs 0 "$BASE/leads")
case "$anon_status" in
  307*login*|308*login*|302*login*) ok "anonymous /leads → redirect to /login" ;;
  *) fail "anonymous /leads expected redirect to /login, got: $anon_status" ;;
esac

# ----------------------------------------------------------------------------
# Test 2: tenant isolation — A reading B's leads → 403
# ----------------------------------------------------------------------------

cross_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$COOKIE_JAR_A" \
  "$BASE/api/leads?slug=smoke-b")
case "$cross_status" in
  403) ok "user A → /api/leads?slug=smoke-b = 403" ;;
  *)   fail "user A → smoke-b should be 403, got $cross_status" ;;
esac

self_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$COOKIE_JAR_A" \
  "$BASE/api/leads?slug=smoke-a")
case "$self_status" in
  200) ok "user A → /api/leads?slug=smoke-a = 200" ;;
  *)   fail "user A → smoke-a should be 200, got $self_status" ;;
esac

# ----------------------------------------------------------------------------
# Test 3: config write appears in audit log
# ----------------------------------------------------------------------------

before_audit=$(curl -sf "$BASE/api/admin/audit?action=config.soul.update" \
  -b "$COOKIE_JAR_ADMIN" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).entries.length')

# Write SOUL.md for tenant A.
curl -sf -X PUT "$BASE/api/config/soul?slug=smoke-a" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE_JAR_A" \
  -d '{"content":"# Smoke test SOUL\n\nThis is a smoke-test persona."}' \
  >/dev/null

after_audit=$(curl -sf "$BASE/api/admin/audit?action=config.soul.update" \
  -b "$COOKIE_JAR_ADMIN" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).entries.length')

if [[ "$after_audit" -gt "$before_audit" ]]; then
  ok "config.soul.update appears in audit ($before_audit → $after_audit)"
else
  fail "audit did not grow after config write ($before_audit → $after_audit)"
fi

# ----------------------------------------------------------------------------
# Test 4: suspend tenant B → user B cannot reach /api/leads
# ----------------------------------------------------------------------------

curl -sf -X PATCH "$BASE/api/admin/tenants" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE_JAR_ADMIN" \
  -d '{"slug":"smoke-b","status":"suspended"}' >/dev/null

suspended_status=$(curl -s -o /dev/null -w '%{http_code}' \
  -b "$COOKIE_JAR_B" \
  "$BASE/api/leads?slug=smoke-b")
case "$suspended_status" in
  403) ok "suspended tenant user B → /api/leads?slug=smoke-b = 403" ;;
  *)   fail "suspended tenant should give 403, got $suspended_status" ;;
esac

# Restore so cleanup matches.
curl -sf -X PATCH "$BASE/api/admin/tenants" \
  -H 'Content-Type: application/json' \
  -b "$COOKIE_JAR_ADMIN" \
  -d '{"slug":"smoke-b","status":"active"}' >/dev/null

# ----------------------------------------------------------------------------
# Test 5: super-admin sees both tenants
# ----------------------------------------------------------------------------

tenant_count=$(curl -sf "$BASE/api/admin/tenants" \
  -b "$COOKIE_JAR_ADMIN" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).tenants.filter(t=>t.slug.startsWith("smoke-")).length')
if [[ "$tenant_count" -ge 2 ]]; then
  ok "super-admin sees both smoke tenants ($tenant_count ≥ 2)"
else
  fail "super-admin should see ≥2 smoke tenants, saw $tenant_count"
fi

# ----------------------------------------------------------------------------
# Result
# ----------------------------------------------------------------------------

if [[ "$FAILED" -eq 0 ]]; then
  info "All acceptance checks passed."
  exit 0
else
  info "Some checks failed (see above)."
  exit 1
fi
