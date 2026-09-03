import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

/**
 * Per-file isolation. Each test file gets its own:
 *   - SQLite auth DB (PORTAL_AUTH_DB)
 *   - Hermes profiles dir (HERMES_PROFILES_DIR)
 *
 * Set before any test imports portal code, because auth.ts / tenants.ts
 * capture these env vars at first call (lazy singleton).
 */

let tmpRoot: string | null = null;

function makeTmp() {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "portal-test-"));
  process.env.PORTAL_AUTH_DB = path.join(tmpRoot, "auth.sqlite");
  process.env.HERMES_PROFILES_DIR = path.join(tmpRoot, "profiles");
  process.env.BETTER_AUTH_SECRET ??= "test-secret-fixed-for-reproducibility";
  process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:0";
  // NODE_ENV is typed read-only in @types/node; cast around it for the test
  // harness only.
  (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
}

makeTmp();

afterEach(async () => {
  // Drop module state so the next test gets a fresh DB. Vitest caches modules
  // within a single file run, so we need explicit reset helpers.
  const authMod = await import("../src/lib/auth");
  const tenantsMod = await import("../src/lib/tenants");
  const playgroundMod = await import("../src/lib/playground");
  await (authMod as unknown as { __resetForTests: () => Promise<void> }).__resetForTests();
  (tenantsMod as unknown as { __resetSchemaForTests: () => void }).__resetSchemaForTests();
  (playgroundMod as unknown as { __resetSchemaForTests: () => void }).__resetSchemaForTests();
  makeTmp();
});
