import { defineConfig } from "vitest/config";

// Integration tests — run real infrastructure (Docker via testcontainers where needed), so they
// live behind a separate config and the dedicated `test:integration` script; the regular `test`
// task never picks them up. Long timeouts cover image pulls; the fork pool isolates native
// modules per test process.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.ts"],
    pool: "forks",
    testTimeout: 240_000,
    hookTimeout: 300_000,
  },
});
