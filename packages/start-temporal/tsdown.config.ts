import { defineConfig } from "tsdown";

// `@btravstack/start-kernel` is a workspace dep; `demesne` / `unthrown` / `zod` are peers. The
// Temporal worker/client (@temporalio) is injected by the consumer, not bundled — this package is
// just the activity dispatch. This config is the single source of truth for the build.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
