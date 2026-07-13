// Factor III: env read + validated once. `DATABASE_URL` is passed to the Prisma driver adapter,
// `PORT` to the listener (via start-api's `ListenConfig`).
//
// `defineConfig` returns a *value* (the tag), so to annotate a `Context<…>` that reads config (the
// Prisma resource does) we name the tag's identity explicitly: it is `ConfigTag<Env>`, the branded
// Self `defineConfig` mints.
import { type ConfigTag, defineConfig } from "@btravstack/start-kernel";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().startsWith("postgres"),
  // 0 is legal: the OS assigns an ephemeral port (the listener reports the real one).
  PORT: z.coerce.number().int().nonnegative().max(65535).default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
});

export type Env = z.infer<typeof schema>;
export type ConfigId = ConfigTag<Env>;

export const { Config, ConfigLive } = defineConfig(schema);
