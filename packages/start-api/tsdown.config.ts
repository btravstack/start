import { defineConfig } from "tsdown";

// `hono` / `@hono/node-server` are runtime deps, `@btravstack/start-kernel` a workspace dep,
// and `demesne` / `unthrown` / `zod` are peers — tsdown externalizes all of them (nothing is
// bundled). This config is the single source of truth for the build.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
