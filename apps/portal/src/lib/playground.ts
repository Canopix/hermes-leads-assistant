import { getDb } from "./tenants";

/**
 * Playground sessions — a registry of Hermes conversations started from the
 * super admin portal so the operator can test a tenant's bot without going
 * through Telegram/WhatsApp.
 *
 * Each row stores the Hermes `session_id` (the value passed to `hermes chat
 * -r <id>`), the tenant it belongs to, who created it, and a friendly title
 * (first message preview). The actual conversation messages live in the
 * tenant's `state.db` — we only persist the pointer here.
 */

export interface PlaygroundSession {
  id: string;
  tenant_slug: string;
  hermes_session_id: string;
  title: string;
  created_by_user_id: string;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS playground_sessions (
  id TEXT PRIMARY KEY,
  tenant_slug TEXT NOT NULL,
  hermes_session_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(hermes_session_id)
);

CREATE INDEX IF NOT EXISTS idx_playground_sessions_user
  ON playground_sessions(created_by_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_playground_sessions_tenant
  ON playground_sessions(tenant_slug, updated_at DESC);
`;

let schemaApplied = false;

async function ensureSchema() {
  if (schemaApplied) return;
  const db = await getDb();
  db.exec(SCHEMA);
  schemaApplied = true;
}

/** Reset for tests. Mirrors `tenants.ts`. */
export function __resetSchemaForTests() {
  schemaApplied = false;
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromMessage(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  if (!clean) return "Nueva conversación";
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
}

/**
 * Upsert a playground session by `hermes_session_id`. Called after every
 * message — the first one creates the row, subsequent ones bump `updated_at`
 * and refresh the title if a better one is provided.
 */
export async function upsertPlaygroundSession(input: {
  tenant_slug: string;
  hermes_session_id: string;
  title?: string;
  created_by_user_id: string;
  created_by_email: string;
}): Promise<PlaygroundSession> {
  await ensureSchema();
  const db = await getDb();
  const now = nowIso();

  const existing = db
    .prepare(`SELECT id FROM playground_sessions WHERE hermes_session_id = ?`)
    .get(input.hermes_session_id) as { id: string } | undefined;

  if (existing) {
    // Title is set ONLY at creation (from the first message). Subsequent
    // upserts just bump `updated_at` so the session floats to the top of
    // the sidebar — this keeps the title stable instead of mutating every
    // turn.
    db.prepare(
      `UPDATE playground_sessions
       SET updated_at = ?
       WHERE id = ?`
    ).run(now, existing.id);
    const row = db
      .prepare(`SELECT * FROM playground_sessions WHERE id = ?`)
      .get(existing.id) as PlaygroundSession;
    return row;
  }

  const session: PlaygroundSession = {
    id: newId(),
    tenant_slug: input.tenant_slug,
    hermes_session_id: input.hermes_session_id,
    title: input.title ?? "Nueva conversación",
    created_by_user_id: input.created_by_user_id,
    created_by_email: input.created_by_email,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO playground_sessions
       (id, tenant_slug, hermes_session_id, title, created_by_user_id, created_by_email, created_at, updated_at)
     VALUES (@id, @tenant_slug, @hermes_session_id, @title, @created_by_user_id, @created_by_email, @created_at, @updated_at)`
  ).run(session);
  return session;
}

/**
 * List all sessions started by a given user. Optional `tenant_slug` filter.
 */
export async function listPlaygroundSessions(opts: {
  userId: string;
  tenantSlug?: string;
}): Promise<PlaygroundSession[]> {
  await ensureSchema();
  const db = await getDb();
  if (opts.tenantSlug) {
    return db
      .prepare(
        `SELECT * FROM playground_sessions
         WHERE created_by_user_id = ? AND tenant_slug = ?
         ORDER BY updated_at DESC
         LIMIT 200`
      )
      .all(opts.userId, opts.tenantSlug) as PlaygroundSession[];
  }
  return db
    .prepare(
      `SELECT * FROM playground_sessions
       WHERE created_by_user_id = ?
       ORDER BY updated_at DESC
       LIMIT 200`
    )
    .all(opts.userId) as PlaygroundSession[];
}

export async function getPlaygroundSession(
  id: string,
  userId: string
): Promise<PlaygroundSession | null> {
  await ensureSchema();
  const db = await getDb();
  const row = db
    .prepare(
      `SELECT * FROM playground_sessions
       WHERE id = ? AND created_by_user_id = ?`
    )
    .get(id, userId) as PlaygroundSession | undefined;
  return row ?? null;
}

/**
 * Delete a session row. Only the portal record is deleted — Hermes' own
 * `state.db` history is preserved (in case the same session is resumed by id
 * from another tool).
 */
export async function deletePlaygroundSession(
  id: string,
  userId: string
): Promise<boolean> {
  await ensureSchema();
  const db = await getDb();
  const result = db
    .prepare(
      `DELETE FROM playground_sessions WHERE id = ? AND created_by_user_id = ?`
    )
    .run(id, userId);
  return result.changes > 0;
}

export { titleFromMessage };
