// Prisma 7 config — the connection URL for the CLI (Migrate) only; the app reads DATABASE_URL
// through the zod-validated config and passes it to the driver adapter (src/infra/prisma.ts).
// The datasource is added only when DATABASE_URL is set, so `prisma generate` works env-free.
import { defineConfig } from "prisma/config";

const url = process.env["DATABASE_URL"];

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(url ? { datasource: { url } } : {}),
});
