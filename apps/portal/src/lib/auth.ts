import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * Auth DB lives outside the repo (it contains user secrets) at:
 *   ~/.hermes/portal/auth.sqlite
 * Override with PORTAL_AUTH_DB. The directory is created on first boot.
 */
async function resolveAuthDbPath(): Promise<string> {
  const override = process.env.PORTAL_AUTH_DB;
  if (override) return override;
  const home =
    process.env.HERMES_HOME ||
    (process.env.HOME ? path.join(process.env.HOME, ".hermes") : "");
  if (!home) throw new Error("HERMES_HOME or HOME must be set for auth DB");
  const dir = path.join(home, "portal");
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "auth.sqlite");
}

type Auth = Awaited<ReturnType<typeof buildAuth>>;

let authInstance: Auth | null = null;
let authInitPromise: Promise<Auth> | null = null;

async function buildAuth() {
  const dbPath = await resolveAuthDbPath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  dbRef = db;

  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (() => {
      throw new Error(
        "BETTER_AUTH_SECRET (or NEXTAUTH_SECRET) must be set. Generate one with: openssl rand -base64 32"
      );
    })();

  const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const instance = betterAuth({
    database: db,
    secret,
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL,
    trustedOrigins: trustedOrigins.length ? trustedOrigins : undefined,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "viewer",
          input: false,
        },
      },
    },
    advanced: {
      crossSubDomainCookies: { enabled: false },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
    },
  });

  // Run Better Auth's own migrations (user, session, account, verification).
  // Idempotent — only applies the diff between what's on disk and what the
  // library expects. This replaces the manual `npx auth migrate` step.
  try {
    const migrations = await getMigrations(instance.options);
    if (
      (migrations.toBeCreated && migrations.toBeCreated.length > 0) ||
      (migrations.toBeAdded && migrations.toBeAdded.length > 0)
    ) {
      await migrations.runMigrations();
    }
  } catch (e) {
    logger.error({ err: e }, "auth_migration_failed");
    throw e;
  }

  return instance;
}

/**
 * Lazy singleton. Next.js route handlers may be warm or cold; we keep one
 * DB connection per process. Init is awaited to avoid races on first hit.
 */
export async function getAuth(): Promise<Auth> {
  if (authInstance) return authInstance;
  if (!authInitPromise) authInitPromise = buildAuth();
  const inst = await authInitPromise;
  authInstance = inst;
  return inst;
}

/**
 * The raw better-sqlite3 instance backing Better Auth. Used by the portal's
 * own tables (tenants, tenant_members, audit_log) so we keep one connection
 * shared with Better Auth's Kysely adapter — same SQLite file, same tx pool.
 */
export async function getAuthDb(): Promise<Database.Database> {
  await getAuth();
  // `buildAuth` stored the instance on `dbRef` for us.
  return dbRef!;
}

let dbRef: Database.Database | null = null;

/**
 * Reset internal singletons. Only for tests — the portal process keeps one
 * connection for its entire lifetime, but tests want isolation per file.
 */
export async function __resetForTests() {
  if (dbRef) {
    try {
      dbRef.close();
    } catch {
      /* already closed */
    }
  }
  authInstance = null;
  authInitPromise = null;
  dbRef = null;
}
