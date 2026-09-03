import Database from "better-sqlite3";
import { getProfilesDir } from "./profiles";
import {
  type LeadView,
  type ConversationMessage,
  type LeadWithConversation,
} from "@hermes-leads/shared";

/**
 * Canonical lead view type — re-exported from `@hermes-leads/shared` so there is
 * one source of truth for the Lead shape across the portal and any other TS
 * consumer. `LeadRecord` is kept as an alias for backwards compatibility
 * with existing imports.
 */
export type LeadRecord = LeadView;
export type { LeadView, ConversationMessage, LeadWithConversation };

const BASE_FIELDS = new Set([
  "name",
  "email",
  "phone",
  "interest",
  "urgency",
  "temperature",
  "summary",
  "confidence",
]);

function parseRawExtraction(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(data)) {
      if (BASE_FIELDS.has(key)) continue;
      if (val !== null && val !== undefined && val !== "") {
        result[key] = String(val);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function mapRow(row: Record<string, unknown>): LeadRecord {
  const rawFields = parseRawExtraction(row.raw_extraction as string | null);
  const manualOverrideRaw = row.manual_override;
  const temperature = String(row.temperature || "tibio") as LeadView["temperature"];
  const column = String(
    row.kanban_column || row.temperature || "tibio"
  ) as LeadView["column"];
  const urgency = String(row.urgency || "medium") as LeadView["urgency"];
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    interest: String(row.interest || ""),
    temperature,
    column,
    platform: String(row.platform || ""),
    urgency,
    summary: String(row.summary || ""),
    last_message: String(row.last_user_message || row.last_assistant_message || ""),
    session_id: row.session_id ? String(row.session_id) : undefined,
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    raw_fields: Object.keys(rawFields).length > 0 ? rawFields : undefined,
    manual_override:
      manualOverrideRaw === 1 || manualOverrideRaw === true ? true : undefined,
  };
}

const LEAD_SELECT = `
  SELECT
    id, name, email, phone, interest, temperature, kanban_column,
    platform, urgency, summary, last_user_message, last_assistant_message,
    raw_extraction, session_id, created_at, updated_at, manual_override
  FROM leads
`;

/**
 * Tenant guard. The slug is validated upstream by resolveTenantContext, but
 * we re-check the regex here so this module is safe to call from anywhere.
 */
function safeSlug(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Refusing to open leads.db for invalid slug: ${slug}`);
  }
  return slug;
}

export function leadsDbPath(slug: string): string | null {
  const safe = safeSlug(slug);
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const dbPath = path.join(
    getProfilesDir(),
    `${safe}-leads`,
    ".lead-capture",
    "leads.db"
  );
  return fs.existsSync(dbPath) ? dbPath : null;
}

export function stateDbPath(slug: string): string | null {
  const safe = safeSlug(slug);
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const dbPath = path.join(getProfilesDir(), `${safe}-leads`, "state.db");
  return fs.existsSync(dbPath) ? dbPath : null;
}

/**
 * LRU cache of per-tenant Database connections, keyed by absolute db path.
 *
 * The previous implementation opened and closed a new better-sqlite3 handle
 * on every call, paying a non-trivial cost (statement cache rebuild, file
 * open, PRAGMA re-run) per query. Holding the handle for the lifetime of the
 * process lets SQLite amortize prepared statements and lets WAL work as
 * intended (WAL is wasted if the connection that opened it is gone).
 *
 * Cap is conservative — better-sqlite3 connections are light, but each open
 * file consumes a file descriptor and a small amount of memory for its page
 * cache. `closeAll()` is exposed for tests.
 */
const DB_CACHE_MAX = 16;
const DB_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  db: Database.Database;
  lastUsed: number;
  readonly: boolean;
}

const dbCache = new Map<string, CacheEntry>();

function touchEntry(key: string, entry: CacheEntry): void {
  entry.lastUsed = Date.now();
  // Move-to-end so iteration order reflects LRU usage.
  dbCache.delete(key);
  dbCache.set(key, entry);
}

function evictIfNeeded(): void {
  while (dbCache.size > DB_CACHE_MAX) {
    const oldest = dbCache.keys().next().value;
    if (oldest === undefined) break;
    const entry = dbCache.get(oldest);
    dbCache.delete(oldest);
    if (entry) {
      try {
        entry.db.close();
      } catch {
        /* ignore double-close */
      }
    }
  }
}

/**
 * Get a cached Database for the given path, opening one if needed.
 *
 * If a cached connection exists but was opened with a different `readonly`
 * flag than requested, it is closed and reopened — mixing read and write
 * handles on the same file is fine for SQLite but a readonly handle cannot
 * write.
 */
function getDb(path: string, opts: { readonly: boolean }): Database.Database {
  const existing = dbCache.get(path);
  if (existing && existing.readonly === opts.readonly) {
    touchEntry(path, existing);
    return existing.db;
  }
  if (existing) {
    try {
      existing.db.close();
    } catch {
      /* ignore */
    }
    dbCache.delete(path);
  }
  const db = new Database(path, { readonly: opts.readonly });
  // WAL-safe reader/writer setup. Fails silently on readonly.
  try {
    if (!opts.readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
    }
    db.pragma("busy_timeout = 5000");
  } catch {
    /* PRAGMA can fail on locked/readonly DBs; the caller will retry. */
  }
  const entry: CacheEntry = { db, lastUsed: Date.now(), readonly: opts.readonly };
  dbCache.set(path, entry);
  evictIfNeeded();
  return db;
}

/** Test-only: close and drop all cached connections. */
export function closeAllDbForTests(): void {
  for (const entry of dbCache.values()) {
    try {
      entry.db.close();
    } catch {
      /* ignore */
    }
  }
  dbCache.clear();
}

/** Internal: visible for tests so they can mock fs/existence checks. */
export function _evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of dbCache) {
    if (now - entry.lastUsed > DB_CACHE_TTL_MS) {
      try {
        entry.db.close();
      } catch {
        /* ignore */
      }
      dbCache.delete(key);
    }
  }
}

export function getLeads(slug: string): LeadRecord[] {
  const dbPath = leadsDbPath(slug);
  if (!dbPath) {
    return [];
  }
  const db = getDb(dbPath, { readonly: true });
  const rows = db
    .prepare(`${LEAD_SELECT} ORDER BY updated_at DESC`)
    .all() as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getLeadById(slug: string, id: string): LeadRecord | null {
  const dbPath = leadsDbPath(slug);
  if (!dbPath) {
    return null;
  }
  const db = getDb(dbPath, { readonly: true });
  const row = db
    .prepare(`${LEAD_SELECT} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function getLeadStats(slug: string) {
  const dbPath = leadsDbPath(slug);
  if (!dbPath) {
    return null;
  }
  const db = getDb(dbPath, { readonly: true });
  const total = (
    db.prepare("SELECT COUNT(*) as total FROM leads").get() as { total: number }
  ).total;
  const today = new Date().toISOString().split("T")[0];
  const todayCount = (
    db
      .prepare("SELECT COUNT(*) as total FROM leads WHERE DATE(created_at) = ?")
      .get(today) as { total: number }
  ).total;

  const byColumn = { frio: 0, tibio: 0, caliente: 0, descartado: 0 };
  for (const col of ["frio", "tibio", "caliente", "descartado"] as const) {
    byColumn[col] = (
      db
        .prepare("SELECT COUNT(*) as total FROM leads WHERE kanban_column = ?")
        .get(col) as { total: number }
    ).total;
  }

  return { total, today: todayCount, by_column: byColumn };
}

export function getConversation(
  slug: string,
  sessionId: string
): ConversationMessage[] {
  const dbPath = stateDbPath(slug);
  if (!dbPath) {
    return [];
  }
  const db = getDb(dbPath, { readonly: true });
  const rows = db
    .prepare(
      "SELECT role, content, tool_name, timestamp FROM messages WHERE session_id = ? AND role IN ('user', 'assistant') AND active = 1 ORDER BY timestamp ASC"
    )
    .all(sessionId) as Record<string, unknown>[];
  return rows.map((row) => ({
    role: String(row.role) as ConversationMessage["role"],
    content: String(row.content || ""),
    tool_name: row.tool_name ? String(row.tool_name) : undefined,
    timestamp: Number(row.timestamp || 0),
  }));
}

export interface UpdateLeadColumnOptions {
  actorEmail?: string;
}

export interface UpdateLeadColumnResult {
  updated: boolean;
  previousColumn?: string;
}

/**
 * Move a lead to a different kanban column from the portal. Marks the lead
 * as manually overridden so the LLM extractor never auto-recategorizes it
 * again, and records a moved_manual event in the same lead_events table the
 * Hermes plugin writes to — so audit history is unified.
 */
export function updateLeadColumn(
  slug: string,
  id: string,
  column: string,
  opts: UpdateLeadColumnOptions = {}
): UpdateLeadColumnResult {
  const dbPath = leadsDbPath(slug);
  if (!dbPath) {
    return { updated: false };
  }
  const db = getDb(dbPath, { readonly: false });
  const txn = db.transaction(() => {
    const prev = db
      .prepare("SELECT kanban_column FROM leads WHERE id = ?")
      .get(id) as { kanban_column?: string } | undefined;
    if (!prev) return false;
    const previousColumn = prev.kanban_column ?? null;
    const nowIso = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE leads
         SET kanban_column = ?,
             column_source = 'manual',
             manual_override = 1,
             column_locked_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(column, nowIso, nowIso, id);
    if (result.changes > 0) {
      db.prepare(
        `INSERT INTO lead_events (lead_id, event_type, payload, created_at)
         VALUES (?, 'moved_manual', ?, ?)`
      ).run(
        id,
        JSON.stringify({
          from: previousColumn,
          to: column,
          actor_email: opts.actorEmail ?? null,
        }),
        nowIso
      );
      return true;
    }
    return false;
  });
  const updated = txn();
  return updated ? { updated: true } : { updated: false };
}

/**
 * Clear the manual-override flag so the LLM extractor resumes auto-categorizing
 * the lead. Used by the "Auto-clasificar" button on the kanban card.
 */
export function clearLeadManualOverride(slug: string, id: string): boolean {
  const dbPath = leadsDbPath(slug);
  if (!dbPath) {
    return false;
  }
  const db = getDb(dbPath, { readonly: false });
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE leads
       SET column_source = 'llm',
           manual_override = 0,
           column_locked_at = NULL,
           updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso, id);
  if (result.changes > 0) {
    db.prepare(
      `INSERT INTO lead_events (lead_id, event_type, payload, created_at)
       VALUES (?, 'unlocked_auto', ?, ?)`
    ).run(id, JSON.stringify({ at: nowIso }), nowIso);
  }
  return result.changes > 0;
}

export function getLeadWithConversation(
  slug: string,
  id: string
): LeadWithConversation | null {
  const lead = getLeadById(slug, id);
  if (!lead) {
    return null;
  }
  const conversation = lead.session_id
    ? getConversation(slug, lead.session_id)
    : [];
  return { ...lead, conversation };
}
