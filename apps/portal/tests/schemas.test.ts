import { describe, expect, it } from "vitest";
import {
  leadColumnSchema,
  soulSchema,
  knowledgeFileSchema,
  businessConfigSchema,
  platformsConfigSchema,
  adminCreateTenantSchema,
  adminPatchUserSchema,
  opsSchema,
} from "../src/lib/schemas";

describe("zod input validation", () => {
  describe("leadColumnSchema", () => {
    it.each(["frio", "tibio", "caliente", "descartado"])("accepts '%s'", (col) => {
      expect(leadColumnSchema.safeParse({ column: col }).success).toBe(true);
    });
    it("rejects unknown columns", () => {
      expect(leadColumnSchema.safeParse({ column: " hacking" }).success).toBe(false);
      expect(leadColumnSchema.safeParse({ column: "hot" }).success).toBe(false);
    });
  });

  describe("soulSchema", () => {
    it("accepts non-empty content within size limit", () => {
      expect(soulSchema.safeParse({ content: "x".repeat(100) }).success).toBe(true);
    });
    it("rejects empty content", () => {
      expect(soulSchema.safeParse({ content: "" }).success).toBe(false);
    });
    it("rejects oversized content", () => {
      expect(soulSchema.safeParse({ content: "x".repeat(64 * 1024 + 1) }).success).toBe(false);
    });
  });

  describe("knowledgeFileSchema", () => {
    it("accepts well-formed md filename", () => {
      expect(
        knowledgeFileSchema.safeParse({ filename: "intro.md", content: "# hi" }).success
      ).toBe(true);
    });
    it("rejects path traversal in filename", () => {
      expect(
        knowledgeFileSchema.safeParse({ filename: "../etc.md", content: "" }).success
      ).toBe(false);
      expect(
        knowledgeFileSchema.safeParse({ filename: "a/b.md", content: "" }).success
      ).toBe(false);
    });
    it("rejects non-md extensions", () => {
      expect(
        knowledgeFileSchema.safeParse({ filename: "a.txt", content: "" }).success
      ).toBe(false);
    });
  });

  describe("businessConfigSchema", () => {
    it("accepts a valid config", () => {
      expect(
        businessConfigSchema.safeParse({
          client_name: "Acme",
          max_messages_per_hour: 50,
          allowed_topics: ["sales"],
        }).success
      ).toBe(true);
    });
    it("rejects unknown keys (.strict)", () => {
      expect(
        businessConfigSchema.safeParse({ evil: "x" }).success
      ).toBe(false);
    });
    it("rejects out-of-range numbers", () => {
      expect(
        businessConfigSchema.safeParse({ max_messages_per_hour: 999999 }).success
      ).toBe(false);
    });
  });

  describe("platformsConfigSchema", () => {
    it("accepts a clean telegram config", () => {
      expect(
        platformsConfigSchema.safeParse({
          telegram: { enabled: true, bot_token: "abc" },
        }).success
      ).toBe(true);
    });
    it("rejects unknown platforms", () => {
      expect(platformsConfigSchema.safeParse({ whatsapp: {} }).success).toBe(false);
    });
  });

  describe("adminCreateTenantSchema", () => {
    it("accepts a clean slug", () => {
      expect(
        adminCreateTenantSchema.safeParse({ slug: "acme-123", name: "Acme" }).success
      ).toBe(true);
    });
    it("rejects uppercase / spaces / special chars in slug", () => {
      for (const slug of ["Acme", "acme x", "acme_x", "acme.x", "../acme"]) {
        expect(
          adminCreateTenantSchema.safeParse({ slug, name: "Acme" }).success,
          `slug=${slug}`
        ).toBe(false);
      }
    });
  });

  describe("adminPatchUserSchema", () => {
    it("accepts a valid role", () => {
      expect(
        adminPatchUserSchema.safeParse({ user_id: "u1", role: "admin" }).success
      ).toBe(true);
    });
    it("rejects unknown roles", () => {
      expect(
        adminPatchUserSchema.safeParse({ user_id: "u1", role: "god" }).success
      ).toBe(false);
    });
  });

  describe("opsSchema", () => {
    it("accepts restart and reindex only", () => {
      expect(opsSchema.safeParse({ op: "restart" }).success).toBe(true);
      expect(opsSchema.safeParse({ op: "reindex" }).success).toBe(true);
      expect(opsSchema.safeParse({ op: "rm-rf" }).success).toBe(false);
    });
  });
});
