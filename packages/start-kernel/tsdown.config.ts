import { defineConfig } from "tsdown";

// `demesne`, `unthrown`, and `zod` are peers (provided by the consumer), so tsdown
// leaves them external — nothing is bundled. This config is the single source of truth
// for the build (`build` / `dev` run bare `tsdown`). Sourcemaps ship for both formats;
// `package.json`'s `files` array ships `src` to back them.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
