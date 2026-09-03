/**
 * One-shot super-admin bootstrap.
 *
 * Usage (from apps/portal):
 *   pnpm create-super-admin -- --email you@example.com --password '...' --name 'Your Name'
 *
 *   — or —
 *
 *   pnpm exec tsx scripts/create-super-admin.ts \
 *     --email you@example.com --password '...' --name 'Your Name'
 *
 * Run once per deployment. The portal cannot function without at least one
 * super_admin (no one would be able to assign tenants to users otherwise).
 *
 * Reads apps/portal/.env automatically so you don't have to source it.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Load .env from the portal root into process.env before importing auth,
// which reads BETTER_AUTH_SECRET / PORTAL_AUTH_DB at init time.
(function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key] === undefined) {
      process.env[key] = val.replace(/^['"]|['"]$/g, "");
    }
  }
})();

import { getAuth, getAuthDb } from "../src/lib/auth";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    throw new Error(`Missing --${name}`);
  }
  return process.argv[i + 1];
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const name = arg("name");

  const auth = await getAuth();
  const db = await getAuthDb();

  // Idempotent: if the user already exists, just promote them.
  const existing = db
    .prepare(`SELECT id FROM user WHERE email = ?`)
    .get(email) as { id?: string } | undefined;

  let userId: string;
  if (existing?.id) {
    userId = existing.id;
    console.log(`User already exists, promoting: ${email} (id=${userId})`);
  } else {
    const res = await auth.api.signUpEmail({
      body: { email, password, name },
    });
    userId = (res as unknown as { user?: { id?: string } }).user?.id ?? "";
    if (!userId) {
      throw new Error("signUpEmail did not return a user id");
    }
  }

  db.prepare(`UPDATE user SET role = 'super_admin' WHERE id = ?`).run(userId);
  console.log(`✓ ${email} is now super_admin (id=${userId})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
