import { describe, expect, it } from "vitest";
import { leadsDbPath, stateDbPath } from "../src/lib/db";

describe("slug guard (path traversal defense)", () => {
  it("accepts well-formed slugs", () => {
    // Returns null when the file doesn't exist on disk, but does NOT throw.
    expect(leadsDbPath("acme")).toBeNull();
    expect(stateDbPath("acme")).toBeNull();
  });

  it("rejects path traversal attempts", () => {
    const evil = [
      "../etc/passwd",
      "..%2Fetc%2Fpasswd",
      "/etc/passwd",
      "a/../b",
      "a b",
      "ACME",
      "a;b",
      "a/b",
    ];
    for (const slug of evil) {
      expect(() => leadsDbPath(slug)).toThrow(/invalid slug/i);
      expect(() => stateDbPath(slug)).toThrow(/invalid slug/i);
    }
  });

  it("allows hyphens and digits", () => {
    expect(() => leadsDbPath("acme-123")).not.toThrow();
    expect(() => stateDbPath("acme-123")).not.toThrow();
  });
});
