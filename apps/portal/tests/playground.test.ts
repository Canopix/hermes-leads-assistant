import { describe, expect, it, beforeEach } from "vitest";
import {
  upsertPlaygroundSession,
  listPlaygroundSessions,
  getPlaygroundSession,
  deletePlaygroundSession,
  titleFromMessage,
  __resetSchemaForTests,
} from "../src/lib/playground";
import { __resetSchemaForTests as resetTenantsSchema } from "../src/lib/tenants";
import { __resetForTests as resetAuth } from "../src/lib/auth";

const USER_A = "user-a";
const USER_B = "user-b";
const EMAIL_A = "a@test";
const EMAIL_B = "b@test";

beforeEach(async () => {
  await resetAuth();
  resetTenantsSchema();
  __resetSchemaForTests();
});

describe("playground sessions — upsert", () => {
  it("creates a new session on first upsert", async () => {
    const s = await upsertPlaygroundSession({
      tenant_slug: "canova-cars",
      hermes_session_id: "sess-1",
      title: "Hola, quiero un auto",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    expect(s.id).toBeTruthy();
    expect(s.hermes_session_id).toBe("sess-1");
    expect(s.title).toBe("Hola, quiero un auto");
    expect(s.created_by_user_id).toBe(USER_A);
  });

  it("upserts by hermes_session_id — same id returns same row, bumps updated_at", async () => {
    const first = await upsertPlaygroundSession({
      tenant_slug: "canova-cars",
      hermes_session_id: "sess-shared",
      title: "primer mensaje",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    // Small delay so updated_at is observably >= created_at.
    await new Promise((r) => setTimeout(r, 5));
    const second = await upsertPlaygroundSession({
      tenant_slug: "canova-cars",
      hermes_session_id: "sess-shared",
      // no title — should keep the original
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("primer mensaje");
    expect(second.updated_at >= first.updated_at).toBe(true);
  });

  it("does not change the title on subsequent upserts even if a new one is provided", async () => {
    // Per design: the title is set only at creation (from the first message).
    // This makes the sidebar list stable instead of mutating every turn.
    const first = await upsertPlaygroundSession({
      tenant_slug: "rio-gallegos",
      hermes_session_id: "sess-2",
      title: "primer",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    const second = await upsertPlaygroundSession({
      tenant_slug: "rio-gallegos",
      hermes_session_id: "sess-2",
      title: "otro mensaje",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    expect(second.title).toBe("primer");
    expect(first.id).toBe(second.id);
  });
});

describe("playground sessions — list", () => {
  it("returns only the calling user's sessions, ordered by updated_at DESC", async () => {
    await upsertPlaygroundSession({
      tenant_slug: "t1",
      hermes_session_id: "a",
      title: "a",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    await new Promise((r) => setTimeout(r, 5));
    await upsertPlaygroundSession({
      tenant_slug: "t1",
      hermes_session_id: "b",
      title: "b",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    // Other user
    await upsertPlaygroundSession({
      tenant_slug: "t1",
      hermes_session_id: "c",
      title: "c",
      created_by_user_id: USER_B,
      created_by_email: EMAIL_B,
    });

    const aList = await listPlaygroundSessions({ userId: USER_A });
    expect(aList).toHaveLength(2);
    expect(aList[0].hermes_session_id).toBe("b"); // most recent first
    expect(aList[1].hermes_session_id).toBe("a");
    expect(aList.every((s) => s.created_by_user_id === USER_A)).toBe(true);

    const bList = await listPlaygroundSessions({ userId: USER_B });
    expect(bList).toHaveLength(1);
    expect(bList[0].hermes_session_id).toBe("c");
  });

  it("filters by tenant_slug when provided", async () => {
    await upsertPlaygroundSession({
      tenant_slug: "canova-cars",
      hermes_session_id: "x",
      title: "x",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    await upsertPlaygroundSession({
      tenant_slug: "rio-gallegos",
      hermes_session_id: "y",
      title: "y",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    const filtered = await listPlaygroundSessions({
      userId: USER_A,
      tenantSlug: "rio-gallegos",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].tenant_slug).toBe("rio-gallegos");
  });
});

describe("playground sessions — ownership", () => {
  it("getPlaygroundSession returns null when the id belongs to another user", async () => {
    const s = await upsertPlaygroundSession({
      tenant_slug: "t",
      hermes_session_id: "s",
      title: "s",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    expect(await getPlaygroundSession(s.id, USER_A)).toBeTruthy();
    expect(await getPlaygroundSession(s.id, USER_B)).toBeNull();
  });

  it("deletePlaygroundSession refuses to delete another user's session", async () => {
    const s = await upsertPlaygroundSession({
      tenant_slug: "t",
      hermes_session_id: "s",
      title: "s",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    const ok = await deletePlaygroundSession(s.id, USER_B);
    expect(ok).toBe(false);
    // Confirm it's still there
    expect(await getPlaygroundSession(s.id, USER_A)).toBeTruthy();
  });

  it("deletePlaygroundSession works for the owner", async () => {
    const s = await upsertPlaygroundSession({
      tenant_slug: "t",
      hermes_session_id: "s",
      title: "s",
      created_by_user_id: USER_A,
      created_by_email: EMAIL_A,
    });
    const ok = await deletePlaygroundSession(s.id, USER_A);
    expect(ok).toBe(true);
    expect(await getPlaygroundSession(s.id, USER_A)).toBeNull();
  });
});

describe("titleFromMessage", () => {
  it("truncates long messages with an ellipsis", () => {
    const longMsg = "a".repeat(100);
    const t = titleFromMessage(longMsg);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith("…")).toBe(true);
  });

  it("collapses whitespace", () => {
    expect(titleFromMessage("hola\n\nmundo\n\t")).toBe("hola mundo");
  });

  it("falls back when the message is empty", () => {
    expect(titleFromMessage("   ")).toBe("Nueva conversación");
  });
});
