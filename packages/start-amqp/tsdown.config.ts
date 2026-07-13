import { defineConfig } from "tsdown";

// `@btravstack/start-kernel` is a workspace dep; `demesne` / `unthrown` / `zod` are peers. The
// AMQP wire driver is injected by the consumer (an interface here, no amqplib dependency), so
// nothing broker-specific is bundled. This config is the single source of truth for the build.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
