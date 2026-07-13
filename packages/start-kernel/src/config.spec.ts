import "@unthrown/vitest";

import { Layer } from "demesne";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineConfig } from "./config.js";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
});

describe("defineConfig", () => {
  it("parses a valid source into the Config service, coercing and defaulting", async () => {
    const { Config, ConfigLive } = defineConfig(schema, { source: { PORT: "8080" } });

    await expect(Layer.build(ConfigLive).map((ctx) => ctx.get(Config))).toBeOkWith({
      PORT: 8080,
      LOG_LEVEL: "info",
    });
  });

  it("reads process.env when no source is given", async () => {
    const before = process.env["LOG_LEVEL"];
    process.env["LOG_LEVEL"] = "debug";
    try {
      const { Config, ConfigLive } = defineConfig(schema);

      await expect(Layer.build(ConfigLive).map((ctx) => ctx.get(Config))).toBeOkWith(
        expect.objectContaining({ LOG_LEVEL: "debug" }),
      );
    } finally {
      if (before === undefined) delete process.env["LOG_LEVEL"];
      else process.env["LOG_LEVEL"] = before;
    }
  });

  it("two configs with distinct ids coexist in one graph (distinct runtime keys)", async () => {
    const app = defineConfig(z.object({ NAME: z.string() }), {
      id: "@test/AppConfig",
      source: { NAME: "app" },
    });
    const lib = defineConfig(z.object({ LEVEL: z.coerce.number() }), {
      id: "@test/LibConfig",
      source: { LEVEL: "3" },
    });

    const both = Layer.merge(app.ConfigLive, lib.ConfigLive);

    await expect(
      Layer.build(both).map((ctx) => [ctx.get(app.Config).NAME, ctx.get(lib.Config).LEVEL]),
    ).toBeOkWith(["app", 3]);
  });

  it("yields a ConfigError naming the offending field on invalid input", async () => {
    const { Config, ConfigLive } = defineConfig(schema, { source: { PORT: "-1" } });

    await expect(Layer.build(ConfigLive).map((ctx) => ctx.get(Config))).toBeErrWith(
      expect.objectContaining({
        _tag: "@btravstack/start/ConfigError",
        issues: expect.stringContaining("PORT"),
      }),
    );
  });
});
