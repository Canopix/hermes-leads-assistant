import { describe, expect, it } from "vitest";
import { recordAudit, listAudit } from "../src/lib/audit";
import {
  createTenant,
  getTenantBySlug,
  addMember,
  listTenantsForUser,
  getMembership,
  listTenants,
  updateTenantStatus,
  getDb,
} from "../src/lib/tenants";

const USER_A = "user-a-uuid";
const USER_B = "user-b-uuid";

async function seedTenant(slug: string, name: string) {
  const t = await createTenant({
    slug,
    name,
    hermesProfile: `${slug}-leads`,
    channels: ["telegram"],
  });
  return t;
}

/**
 * Insert a stub row in the `user` table so tenant_members' FK passes.
 * Matches Better Auth's schema: id, name, email, emailVerified, image,
 * createdAt, updatedAt. Optionally sets a role.
 */
async function seedUser(id: string, email: string, role: string | null = null) {
  const db = await getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, role)
     VALUES (?, ?, ?, 0, NULL, ?, ?, ?)`
  ).run(id, email, email, now, now, role);
}

describe("tenants model", () => {
  it("creates and retrieves a tenant by slug", async () => {
    const t = await seedTenant("acme", "Acme Inc");
    expect(t.slug).toBe("acme");
    expect(t.channels).toEqual(["telegram"]);

    const found = await getTenantBySlug("acme");
    expect(found?.id).toBe(t.id);
    expect(found?.status).toBe("active");
  });

  it("prevents duplicate slugs (UNIQUE)", async () => {
    await seedTenant("dup", "First");
    await expect(seedTenant("dup", "Second")).rejects.toThrow();
  });

  it("lists tenants for a user via membership", async () => {
    await seedUser(USER_A, "a@x.test");
    const t1 = await seedTenant("t1", "T1");
    const t2 = await seedTenant("t2", "T2");
    await seedTenant("t3", "T3"); // not a member

    await addMember(USER_A, t1.id, "owner");
    await addMember(USER_A, t2.id, "viewer");

    const list = await listTenantsForUser(USER_A);
    expect(list.map((x) => x.slug).sort()).toEqual(["t1", "t2"]);
  });

  it("returns the role of a member", async () => {
    await seedUser(USER_A, "a@x.test");
    const t = await seedTenant("rolecheck", "RC");
    await addMember(USER_A, t.id, "admin");
    const m = await getMembership(USER_A, t.id);
    expect(m?.role).toBe("admin");
    const mB = await getMembership(USER_B, t.id);
    expect(mB).toBeNull();
  });

  it("listTenants returns every tenant (for super admin)", async () => {
    await seedTenant("s1", "S1");
    await seedTenant("s2", "S2");
    const all = await listTenants();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("listTenantsForUser excludes tenants the user is not a member of", async () => {
    await seedUser(USER_A, "a@x.test");
    const t1 = await seedTenant("x1", "X1");
    await seedTenant("x2", "X2");
    await addMember(USER_A, t1.id, "owner");

    const list = await listTenantsForUser(USER_A);
    expect(list.map((x) => x.slug)).toEqual(["x1"]);
  });

  it("listTenantsForUser hides suspended tenants", async () => {
    await seedUser(USER_A, "a@x.test");
    const t1 = await seedTenant("y1", "Y1");
    await addMember(USER_A, t1.id, "owner");
    await updateTenantStatus("y1", "suspended");

    const list = await listTenantsForUser(USER_A);
    expect(list.map((x) => x.slug)).toEqual([]);
  });
});

describe("audit log", () => {
  it("records and retrieves audit entries", async () => {
    const t = await seedTenant("aud", "Aud");
    await recordAudit({
      actor_user_id: USER_A,
      actor_email: "a@x.test",
      tenant_id: t.id,
      action: "config.soul.update",
      target: "SOUL.md",
      payload: { before: "x", after: "y" },
      ip: "127.0.0.1",
    });

    const entries = await listAudit({ tenantId: t.id });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("config.soul.update");
    expect(entries[0].target).toBe("SOUL.md");
    expect(JSON.parse(entries[0].payload!)).toEqual({ before: "x", after: "y" });
  });

  it("filters by action", async () => {
    const t = await seedTenant("aud2", "Aud2");
    await recordAudit({
      actor_user_id: USER_A,
      actor_email: "a@x.test",
      tenant_id: t.id,
      action: "config.soul.update",
    });
    await recordAudit({
      actor_user_id: USER_A,
      actor_email: "a@x.test",
      tenant_id: t.id,
      action: "config.business.update",
    });

    const soul = await listAudit({ tenantId: t.id, action: "config.soul.update" });
    expect(soul).toHaveLength(1);
  });

  it("serializes payload as JSON string", async () => {
    const t = await seedTenant("aud3", "Aud3");
    await recordAudit({
      actor_user_id: null,
      actor_email: null,
      tenant_id: t.id,
      action: "system.test",
      payload: { nested: { deep: [1, 2, 3] } },
    });
    const rows = await listAudit({ tenantId: t.id });
    expect(rows[0].payload).toBe(JSON.stringify({ nested: { deep: [1, 2, 3] } }));
  });
});
