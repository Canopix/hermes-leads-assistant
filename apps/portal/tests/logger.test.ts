import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { Writable } from "node:stream";

/**
 * Logger tests. We spawn pino with a custom destination stream to capture
 * output lines, then assert that sensitive keys never make it to the log.
 */

function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

describe("logger redaction", () => {
  beforeEach(() => {
    // Force JSON output (no pretty transport) for deterministic parsing.
    (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
  });

  afterEach(() => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = "test";
  });

  it("redacts password and token fields from log output", async () => {
    const { pino } = await import("pino");
    const { stream, lines } = captureStream();
    const log = pino(
      {
        level: "info",
        redact: {
          paths: ["password", "token", "*.password", "*.token", "*.bot_token"],
          censor: "[REDACTED]",
        },
      },
      stream
    );

    log.info(
      {
        user: "x",
        password: "super-secret",
        token: "abc.def.ghi",
        nested: { bot_token: "telegram:123" },
      },
      "login_attempt"
    );

    // Flush synchronously (pino writes on tick).
    await new Promise((r) => setImmediate(r));

    const entry = JSON.parse(lines[0]);
    expect(entry.password).toBe("[REDACTED]");
    expect(entry.token).toBe("[REDACTED]");
    expect(entry.nested.bot_token).toBe("[REDACTED]");
    expect(entry.user).toBe("x");
  });

  it("does not leak Authorization-style headers when logged as req.headers", async () => {
    const { pino } = await import("pino");
    const { stream, lines } = captureStream();
    const log = pino(
      {
        level: "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['x-api-key']",
          ],
          censor: "[REDACTED]",
        },
      },
      stream
    );

    log.info(
      {
        req: {
          headers: {
            authorization: "Bearer abc123",
            cookie: "session=xyz",
            "x-api-key": "key",
            "user-agent": "curl/8",
          },
        },
      },
      "request"
    );
    await new Promise((r) => setImmediate(r));

    const entry = JSON.parse(lines[0]);
    expect(entry.req.headers.authorization).toBe("[REDACTED]");
    expect(entry.req.headers.cookie).toBe("[REDACTED]");
    expect(entry.req.headers["x-api-key"]).toBe("[REDACTED]");
    expect(entry.req.headers["user-agent"]).toBe("curl/8");
  });
});
