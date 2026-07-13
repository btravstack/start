// Factor III in one call: read + validate the environment once, at the edge. `Config` is a
// demesne tag injected wherever config is needed; a parse failure is a modeled `ConfigError`.
import { defineConfig } from "@btravstack/start-kernel";
import { z } from "zod";

export const { Config, ConfigLive } = defineConfig(
  z.object({
    // 0 is legal: the OS assigns an ephemeral port (the listener reports the real one) —
    // exactly what an integration test or parallel CI run wants.
    PORT: z.coerce.number().int().nonnegative().max(65535).default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
  }),
);
