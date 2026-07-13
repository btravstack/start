import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Type-only tests carry no runtime; they're checked by `tsc`, not coverage.
      exclude: ["src/**/*.test-d.ts"],
      // Thresholds are intentionally omitted while the kernel is incubating — the
      // transport seam (Host / handler) is not landed yet. Lock them in like core once
      // the surface stabilizes.
    },
  },
});
