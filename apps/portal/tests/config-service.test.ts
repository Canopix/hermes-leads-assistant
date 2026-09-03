import { describe, expect, it, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getSoul,
  updateSoul,
  createKnowledgeFile,
  getKnowledgeFile,
  updateKnowledgeFile,
  deleteKnowledgeFile,
  listKnowledgeFiles,
} from "../src/lib/config-service";

const SLUG = "configtest";

async function ensureProfile() {
  const dir = path.join(process.env.HERMES_PROFILES_DIR!, `${SLUG}-leads`);
  await fs.mkdir(path.join(dir, "knowledge"), { recursive: true });
}

describe("config-service (SOUL.md + knowledge base)", () => {
  beforeEach(async () => {
    await ensureProfile();
  });

  it("writes SOUL.md and creates a .bak on the second write (config diff trail)", async () => {
    expect(updateSoul(SLUG, "# v1\n")).toBe(true);
    expect(getSoul(SLUG)).toBe("# v1\n");

    // First write: no .bak yet
    const bakPath = path.join(process.env.HERMES_PROFILES_DIR!, `${SLUG}-leads`, "SOUL.md.bak");
    await expect(fs.access(bakPath)).rejects.toThrow();

    // Second write: .bak must contain the previous version.
    expect(updateSoul(SLUG, "# v2\n")).toBe(true);
    expect(getSoul(SLUG)).toBe("# v2\n");
    const bak = await fs.readFile(bakPath, "utf-8");
    expect(bak).toBe("# v1\n");
  });

  it("returns false when the profile dir doesn't exist", () => {
    expect(getSoul("does-not-exist")).toBeNull();
    expect(updateSoul("does-not-exist", "x")).toBe(false);
  });

  it("creates, reads, updates, and deletes knowledge files", () => {
    expect(createKnowledgeFile(SLUG, "intro.md", "# Intro\n")).toBe(true);
    expect(getKnowledgeFile(SLUG, "intro.md")).toBe("# Intro\n");

    // Listed.
    const files = listKnowledgeFiles(SLUG);
    expect(files.some((f) => f.name === "intro.md")).toBe(true);

    // Update with backup.
    expect(updateKnowledgeFile(SLUG, "intro.md", "# Intro v2\n")).toBe(true);
    expect(getKnowledgeFile(SLUG, "intro.md")).toBe("# Intro v2\n");

    // Delete.
    expect(deleteKnowledgeFile(SLUG, "intro.md")).toBe(true);
    expect(getKnowledgeFile(SLUG, "intro.md")).toBeNull();
  });

  it("rejects path-traversal filenames", () => {
    expect(createKnowledgeFile(SLUG, "../escape.md", "x")).toBe(false);
    expect(getKnowledgeFile(SLUG, "../../etc/passwd.md")).toBeNull();
    expect(updateKnowledgeFile(SLUG, "a/b.md", "x")).toBe(false);
    expect(deleteKnowledgeFile(SLUG, "a/b.md")).toBe(false);
  });
});
