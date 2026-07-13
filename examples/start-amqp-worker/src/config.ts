// Factor III: app config read once. (The broker URL is a deployment endpoint read at process
// bootstrap in server.ts, before the graph — see the README.)
import { defineConfig } from "@btravstack/start-kernel";
import { z } from "zod";

export const { Config, ConfigLive } = defineConfig(
  z.object({
    LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
    CHARGE_LIMIT: z.coerce.number().int().positive().default(1000),
  }),
);
