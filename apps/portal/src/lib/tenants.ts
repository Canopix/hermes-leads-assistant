import Database from "better-sqlite3";
import { getAuthDb } from "./auth";

/**
 * Portal metadata lives in the same SQLite DB as Better Auth. We attach our
 * own tables (tenants, tenant_members, audit_log) using Better Auth's
 * initialized connection so transactions are consistent with auth writes.
 *
 * The previous design read tenants.json from disk; that file is now an
 * install-time convenience (the wizard / CLI still write it) but the
 * portal's source of truth is the `tenants` table below.
 */

export type TenantStatus = "active" | "suspended" | "inactive";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  hermes_profile: string;
  status: TenantStatus;
  channels_raw: string | null;
  created_at: string;
  updated_at: string;
}

export type TenantRole = "owner" | "admin" | "viewer";

export interface TenantMember {
  user_id: string;
  tenant_id: string;
  role: TenantRole;
  created_at: string;
}

export interface TenantWithContext extends Tenant {
  channels: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hermes_profile TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  channels TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_members (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT,
  actor_email TEXT,
  tenant_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  payload TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant ON tenant_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id, created_at DESC);
`;

let schemaApplied = false;

export async function getDb(): Promise<Database.Database> {
  const db = await getAuthDb();
  if (!schemaApplied) {
    db.exec(SCHEMA);
    schemaApplied = true;
  }
  return db;
}

/** Reset schema-applied flag so a fresh DB after `__resetForTests` re-creates tables. */
export function __resetSchemaForTests() {
  schemaApplied = false;
}

function rowToTenant(row: Tenant): TenantWithContext {
  return {
    ...row,
    channels: row.channels_raw ? (JSON.parse(row.channels_raw) as string[]) : [],
  };
}

export async function listTenants(): Promise<TenantWithContext[]> {
  const db = await getDb();
  const rows = db
    .prepare(`SELECT * FROM tenants ORDER BY name COLLATE NOCASE ASC`)
    .all() as Tenant[];
  return rows.map(rowToTenant);
}

export async function getTenantBySlug(slug: string): Promise<TenantWithContext | null> {
  const db = await getDb();
  const row = db
    .prepare(`SELECT * FROM tenants WHERE slug = ?`)
    .get(slug) as Tenant | undefined;
  return row ? rowToTenant(row) : null;
}

export async function getTenantById(id: string): Promise<TenantWithContext | null> {
  const db = await getDb();
  const row = db
    .prepare(`SELECT * FROM tenants WHERE id = ?`)
    .get(id) as Tenant | undefined;
  return row ? rowToTenant(row) : null;
}

/**
 * Returns the tenants the given user is a member of, with their role.
 */
export async function listTenantsForUser(
  userId: string
): Promise<Array<TenantWithContext & { role: TenantRole }>> {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT t.*, m.role
       FROM tenants t
       INNER JOIN tenant_members m ON m.tenant_id = t.id
       WHERE m.user_id = ? AND t.status = 'active'
       ORDER BY t.name COLLATE NOCASE ASC`
    )
    .all(userId) as Array<Tenant & { role: TenantRole }>;
  return rows.map((r) => ({ ...rowToTenant(r), role: r.role }));
}

export async function getMembership(
  userId: string,
  tenantId: string
): Promise<TenantMember | null> {
  const db = await getDb();
  const row = db
    .prepare(
      `SELECT * FROM tenant_members WHERE user_id = ? AND tenant_id = ?`
    )
    .get(userId, tenantId) as TenantMember | undefined;
  return row ?? null;
}

function newId(): string {
  // Avoid extra deps; crypto.randomUUID exists on Node 18+.
  return globalThis.crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export async function createTenant(input: {
  slug: string;
  name: string;
  hermesProfile?: string;
  channels?: string[];
}): Promise<TenantWithContext> {
  const db = await getDb();
  const slugPattern = /^[a-z0-9-]+$/;
  if (!slugPattern.test(input.slug)) {
    throw new Error(`Invalid slug "${input.slug}" (must match ${slugPattern})`);
  }
  const profile = input.hermesProfile || `${input.slug}-leads`;
  const ts = now();
  const tenant: Tenant = {
    id: newId(),
    slug: input.slug,
    name: input.name,
    hermes_profile: profile,
    status: "active",
    channels_raw: JSON.stringify(input.channels ?? ["telegram"]),
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO tenants (id, slug, name, hermes_profile, status, channels, created_at, updated_at)
     VALUES (@id, @slug, @name, @hermes_profile, @status, @channels_raw, @created_at, @updated_at)`
  ).run(tenant);
  return rowToTenant(tenant);
}

export async function updateTenantStatus(
  slug: string,
  status: TenantStatus
): Promise<boolean> {
  const db = await getDb();
  const res = db
    .prepare(`UPDATE tenants SET status = ?, updated_at = ? WHERE slug = ?`)
    .run(status, now(), slug);
  return res.changes > 0;
}

/**
 * Hard-delete a tenant row and its memberships.
 *
 * `audit_log` rows are intentionally preserved: the schema does not declare a
 * FK with cascade there, and the audit trail is meant to outlive the entities
 * it references. Callers should record a `tenant_deleted` audit entry before
 * invoking this so there is a self-contained record of the deletion event.
 *
 * Returns true if the tenant existed (and was deleted), false otherwise.
 */
export async function deleteTenant(slug: string): Promise<boolean> {
  const db = await getDb();
  let deleted = false;
  const tx = db.transaction(() => {
    const tenant = db
      .prepare(`SELECT id FROM tenants WHERE slug = ?`)
      .get(slug) as { id: string } | undefined;
    if (!tenant) return;
    // tenant_members has ON DELETE CASCADE, but SQLite only honors that when
    // PRAGMA foreign_keys=ON — delete explicitly to be safe across runtimes.
    db.prepare(`DELETE FROM tenant_members WHERE tenant_id = ?`).run(tenant.id);
    const res = db.prepare(`DELETE FROM tenants WHERE id = ?`).run(tenant.id);
    deleted = res.changes > 0;
  });
  tx();
  return deleted;
}

export async function addMember(
  userId: string,
  tenantId: string,
  role: TenantRole
): Promise<void> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO tenant_members (user_id, tenant_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, tenant_id) DO UPDATE SET role = excluded.role`
  ).run(userId, tenantId, role, now());
}

export async function removeMember(
  userId: string,
  tenantId: string
): Promise<void> {
  const db = await getDb();
  db.prepare(
    `DELETE FROM tenant_members WHERE user_id = ? AND tenant_id = ?`
  ).run(userId, tenantId);
}

/**
 * One-shot import from the legacy tenants.json file. Idempotent: existing
 * slugs are skipped. Safe to call at boot.
 */
export async function importTenantsFromJsonFile(path: string): Promise<number> {
  const fs = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf-8");
  } catch {
    return 0;
  }
  const data = JSON.parse(raw) as {
    tenants?: Array<{
      slug: string;
      name: string;
      hermes_profile?: string;
      status?: string;
      channels?: string[];
    }>;
  };
  let imported = 0;
  for (const t of data.tenants ?? []) {
    const existing = await getTenantBySlug(t.slug);
    if (existing) continue;
    await createTenant({
      slug: t.slug,
      name: t.name,
      hermesProfile: t.hermes_profile,
      channels: t.channels,
    });
    imported++;
  }
  return imported;
}
