import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  updateLeadColumn,
  clearLeadManualOverride,
} from "../src/lib/db";

const SLUG = "test-tenant";
const LEAD_ID = "lead-1";

function leadsDbForSlug(slug: string): string {
  const profilesDir = process.env.HERMES_PROFILES_DIR!;
  const dir = path.join(profilesDir, `${slug}-leads`, ".lead-capture");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "leads.db");
}

function createLeadsDb(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      kanban_column TEXT DEFAULT 'tibio',
      temperature TEXT DEFAULT 'tibio',
      updated_at TEXT,
      column_source TEXT DEFAULT 'llm',
      column_locked_at TEXT,
      manual_override INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS lead_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO leads (id, kanban_column, temperature, manual_override)
     VALUES (?, 'tibio', 'tibio', 0)`
  ).run(LEAD_ID);
  db.close();
}

// setup.ts wipes HERMES_PROFILES_DIR on every afterEach, so re-seed before each.
beforeEach(() => {
  const dbPath = leadsDbForSlug(SLUG);
  if (!existsSync(dbPath)) createLeadsDb(dbPath);
});

function readLead() {
  const dbPath = leadsDbForSlug(SLUG);
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT kanban_column, temperature, manual_override, column_source FROM leads WHERE id = ?"
      )
      .get(LEAD_ID) as {
      kanban_column: string;
      temperature: string;
      manual_override: number;
      column_source: string;
    };
  } finally {
    db.close();
  }
}

function readEvents(): Array<{ event_type: string; payload: string }> {
  const dbPath = leadsDbForSlug(SLUG);
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT event_type, payload FROM lead_events WHERE lead_id = ? ORDER BY id ASC"
      )
      .all(LEAD_ID) as Array<{ event_type: string; payload: string }>;
  } finally {
    db.close();
  }
}

describe("kanban manual override — respect human", () => {
  it("marks the lead as manually overridden when moved from the portal", () => {
    const before = readLead();
    expect(before.kanban_column).toBe("tibio");
    expect(before.manual_override).toBe(0);

    const result = updateLeadColumn(SLUG, LEAD_ID, "frio", {
      actorEmail: "operator@test",
    });
    expect(result.updated).toBe(true);

    const after = readLead();
    expect(after.kanban_column).toBe("frio");
    expect(after.manual_override).toBe(1);
    expect(after.column_source).toBe("manual");

    const events = readEvents();
    const movedEvent = events.find((e) => e.event_type === "moved_manual");
    expect(movedEvent).toBeDefined();
    const payload = JSON.parse(movedEvent!.payload);
    expect(payload.to).toBe("frio");
    expect(payload.actor_email).toBe("operator@test");
  });

  it("clears the override when unlock is called", () => {
    // Pre-condition: simulate a prior manual move.
    const dbPath = leadsDbForSlug(SLUG);
    const setup = new Database(dbPath);
    setup.prepare(
      `UPDATE leads SET kanban_column = 'frio', manual_override = 1, column_source = 'manual' WHERE id = ?`
    ).run(LEAD_ID);
    setup.close();

    expect(readLead().manual_override).toBe(1);

    const ok = clearLeadManualOverride(SLUG, LEAD_ID);
    expect(ok).toBe(true);

    const after = readLead();
    expect(after.manual_override).toBe(0);
    expect(after.column_source).toBe("llm");
    // Column stays where it was — the LLM will update it on next message.
    expect(after.kanban_column).toBe("frio");

    const events = readEvents();
    const unlocked = events.find((e) => e.event_type === "unlocked_auto");
    expect(unlocked).toBeDefined();
  });

  it("returns updated=false when the lead does not exist", () => {
    const r = updateLeadColumn(SLUG, "does-not-exist", "caliente");
    expect(r.updated).toBe(false);
  });

  it("returns false from unlock when the lead does not exist", () => {
    expect(clearLeadManualOverride(SLUG, "does-not-exist")).toBe(false);
  });
});
