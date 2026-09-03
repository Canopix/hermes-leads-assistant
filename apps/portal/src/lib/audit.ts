import { getDb } from "./tenants";

export interface AuditEntry {
  actor_user_id: string | null;
  actor_email: string | null;
  tenant_id: string | null;
  action: string;
  target?: string | null;
  payload?: unknown;
  ip?: string | null;
}

export interface AuditRow {
  id: number;
  actor_user_id: string | null;
  actor_email: string | null;
  tenant_id: string | null;
  action: string;
  target: string | null;
  payload: string | null;
  ip: string | null;
  created_at: string;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO audit_log
       (actor_user_id, actor_email, tenant_id, action, target, payload, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.actor_user_id,
    entry.actor_email,
    entry.tenant_id,
    entry.action,
    entry.target ?? null,
    entry.payload !== undefined ? JSON.stringify(entry.payload) : null,
    entry.ip ?? null,
    new Date().toISOString()
  );
}

export async function listAudit(opts: {
  tenantId?: string;
  actorUserId?: string;
  action?: string;
  limit?: number;
}): Promise<AuditRow[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.tenantId) {
    conditions.push("tenant_id = ?");
    params.push(opts.tenantId);
  }
  if (opts.actorUserId) {
    conditions.push("actor_user_id = ?");
    params.push(opts.actorUserId);
  }
  if (opts.action) {
    conditions.push("action = ?");
    params.push(opts.action);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params, limit) as AuditRow[];
  return rows;
}
