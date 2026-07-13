// Shared, internal (not part of the public surface): render a zod parse failure into a compact,
// stable one-line string of `path: message` pairs. Used by both `defineConfig` and the contract
// input parser so their error messages read identically.

import type { z } from "zod";

export const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
