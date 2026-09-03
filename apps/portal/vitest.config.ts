import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // better-sqlite3 is a native module; isolate:false keeps one process
    // per file but skips the slow module-reload sandboxing between tests.
    isolate: false,
  },
});
