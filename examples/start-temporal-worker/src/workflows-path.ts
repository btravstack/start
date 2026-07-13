// Resolve the workflow module for the Temporal Worker's bundler. Under `tsx` (the dev script) the
// running module is `.ts` and only `workflow.ts` exists on disk; from compiled output it would be
// `.js`. Resolving relative to the CURRENT module's own extension points at a file that actually
// exists in both worlds — a hardcoded "./workflow.js" would fail under tsx (no build step here).
import { fileURLToPath } from "node:url";

export const workflowsPath = (importMetaUrl: string): string =>
  fileURLToPath(
    new URL(importMetaUrl.endsWith(".ts") ? "./workflow.ts" : "./workflow.js", importMetaUrl),
  );
