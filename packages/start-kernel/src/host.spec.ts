import "@unthrown/vitest";

import { Layer, Tag } from "demesne";
import { Ok } from "unthrown";
import { describe, expect, it } from "vitest";

import { runHost } from "./host.js";

class Resource extends Tag("@btravstack/start/test/Resource")<
  Resource,
  { readonly id: number }
>() {}

const resourceLayer = (id: number, onRelease: () => void) =>
  Layer.acquireRelease(
    Resource,
    () => Ok({ id }),
    () => onRelease(),
  );

describe("runHost", () => {
  it("runs onReady then use with the built context, then closes the scope (LIFO teardown)", async () => {
    let released = false;
    let readyId: number | undefined;
    const app = resourceLayer(1, () => {
      released = true;
    });

    const outcome = await runHost(app, {
      onReady: (ctx) => {
        readyId = ctx.get(Resource).id;
      },
      use: (ctx) => Ok(ctx.get(Resource).id),
    });

    expect(outcome).toBeOkWith(1);
    expect(readyId).toBe(1);
    expect(released).toBe(true);
  });

  it("blocks until a shutdown signal by default, then tears the scope down", async () => {
    let released = false;
    const app = resourceLayer(2, () => {
      released = true;
    });

    const running = runHost(app, { signals: ["SIGUSR2"] });
    // Let the scope build and register the signal handler before we fire it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(released).toBe(false);

    process.emit("SIGUSR2", "SIGUSR2");

    expect(await running).toBeOkWith(undefined);
    expect(released).toBe(true);
  });
});
