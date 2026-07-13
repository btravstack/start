import { defineConfig } from "@btravstack/start-kernel";
import { z } from "zod";

export const { Config, ConfigLive } = defineConfig(
  z.object({
    LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
    CHARGE_LIMIT: z.coerce.number().int().positive().default(1000),
  }),
);
