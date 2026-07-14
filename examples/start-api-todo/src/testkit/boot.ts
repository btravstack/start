// The integration suite's ONE seam onto btravstack start + demesne. It boots the real app —
// `runHost(AppLayer)` exactly as `server.ts` does — on an ephemeral port (PORT=0), holds the scope
// open for the caller, and hands back a transport-neutral handle: a `baseUrl` to drive with plain
// `fetch`, and `close()` to tear the listener down. The spec that consumes this knows only HTTP, so
// swapping start/demesne for anything else would touch this file and nothing else.
//
// Why a bridge is needed: `runHost`'s scope lifetime IS its `use` callback (kernel invariant K2 —
// there is no open/hold/close handle). To span a test's lifetime we pin the scope open with two
// promises: `use` resolves `ready` outward once the app is up, then awaits `release`; `close()`
// fires `release`, letting `use` return so every finalizer runs in reverse (the listener stops
// accepting). All of that lives here — never in a test body.
import { HttpServer } from "@btravstack/start-api";
import { runHost } from "@btravstack/start-kernel";
import { fromSafePromise } from "unthrown";
import { vi } from "vitest";

export type BootedApp = {
  /** Base URL of the live listener — drive it with plain `fetch`. */
  readonly baseUrl: string;
  /** Close the scope: run every finalizer in reverse, after which the port stops accepting. */
  readonly close: () => Promise<void>;
};

export const boot = async (): Promise<BootedApp> => {
  // `vi.stubEnv` (paired with `unstubEnvs: true` in the config) sets the config seam without
  // mutating `process.env` permanently — the worker's env is restored before every test, so a boot
  // here can never leak PORT/LOG_LEVEL into a later file or make failures order-dependent.
  vi.stubEnv("PORT", "0");
  vi.stubEnv("LOG_LEVEL", "warn");
  const { AppLayer } = await import("../app.js");

  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  let ready!: (baseUrl: string) => void;
  const readyUrl = new Promise<string>((resolve) => {
    ready = resolve;
  });

  // `use` never asserts — it only publishes the base URL outward and then parks on `release`,
  // keeping the scope (and the listener) alive until `close()` is called.
  const outcome = runHost(AppLayer, {
    use: (ctx) => {
      ready(`http://localhost:${ctx.get(HttpServer).port}`);
      return fromSafePromise(released);
    },
  });

  // A boot failure (config or listen error) settles `outcome` before `use` ever runs, so `readyUrl`
  // would hang. Race the two: a non-ok boot throws here, failing setup with the underlying error
  // preserved as `cause`; a successful boot resolves `readyUrl` while this branch stays pending
  // until `close()`.
  const bootFailure = outcome.then((result) =>
    result.match({
      ok: () => new Promise<never>(() => undefined), // reached only at close — not a boot failure
      err: (error) => {
        throw new Error(`startup failed: ${error._tag}`, { cause: error });
      },
      defect: (cause) => {
        throw new Error("startup panicked", { cause });
      },
    }),
  );

  const baseUrl = await Promise.race([readyUrl, bootFailure]);

  const close = async (): Promise<void> => {
    release();
    (await outcome).match({
      ok: () => undefined,
      err: (error) => {
        throw new Error(`shutdown failed: ${error._tag}`, { cause: error });
      },
      defect: (cause) => {
        throw new Error("shutdown panicked", { cause });
      },
    });
  };

  return { baseUrl, close };
};
