// runHost — the process loop (factor IX, disposability). Promotes the example's `server.ts`:
// given a fully-assembled `Layer<P, E, Scope>` (the transport's resource layer already merged
// in), it builds the graph once with `Layer.scoped`, runs `use`, then closes the scope so every
// finalizer (`acquireRelease` / `onStop`) runs in reverse order — whether `use` resolved, failed,
// or the build failed partway. The default `use` blocks until a shutdown signal, which is the
// long-lived-server case; teardown then runs on SIGINT/SIGTERM.
//
// Invariant K2 — the scope's lifetime IS `use`; there is no open/hold/close handle.
// Invariant K3 — `runHost` requires `Needs = Scope` and nothing more; a still-unmet service is a
// compile error at the call, never a boot-time throw. It never calls `Layer.build` (a resource
// graph carries `Scope`, which `build` rejects) — only `scoped`, which discharges it.

import { type Context, Layer, type Scope } from "demesne";
import { type AsyncResult, fromSafePromise, type Result } from "unthrown";

const DEFAULT_SIGNALS = ["SIGINT", "SIGTERM"] as const satisfies readonly NodeJS.Signals[];

type BaseOptions<P> = {
  /** Signals that resolve the default `use`. Default: `["SIGINT", "SIGTERM"]`. */
  readonly signals?: readonly NodeJS.Signals[];
  /** Ran after the graph is built (post-`onStart`), before `use` — e.g. a readiness log line. */
  readonly onReady?: (ctx: Context<P>) => void;
};

export type RunHostOptions<P, A, E2> = BaseOptions<P> & {
  /** What to do with the built context. Default: block until a shutdown signal (`A = void`). */
  readonly use?: (ctx: Context<P>) => Result<A, E2> | AsyncResult<A, E2>;
};

// Two call shapes so the value channel is honest: with a `use`, the result carries its value and
// unions its error; without one, the result is `AsyncResult<void, E>` and there is no `A` type
// parameter to (mis)instantiate — `runHost<P, E, number>(app)` matches neither overload.
type RunHost = {
  <P, E, A, E2>(
    app: Layer<P, E, Scope>,
    opts: BaseOptions<P> & {
      readonly use: (ctx: Context<P>) => Result<A, E2> | AsyncResult<A, E2>;
    },
  ): AsyncResult<A, E | E2>;
  <P, E>(app: Layer<P, E, Scope>, opts?: BaseOptions<P>): AsyncResult<void, E>;
};

const waitForShutdown = (signals: readonly NodeJS.Signals[]): Promise<void> =>
  new Promise<void>((resolve) => {
    const shutdown = (): void => {
      // Remove every registered handler on the first signal, so the handlers for the *other*
      // signals don't linger on the process after shutdown resolves.
      for (const signal of signals) process.removeListener(signal, shutdown);
      resolve();
    };
    for (const signal of signals) process.on(signal, shutdown);
  });

export const runHost: RunHost = (<P, E, A, E2>(
  app: Layer<P, E, Scope>,
  opts?: RunHostOptions<P, A, E2>,
): AsyncResult<A, E | E2> => {
  const signals = opts?.signals ?? DEFAULT_SIGNALS;
  const use = opts?.use;
  const onReady = opts?.onReady;

  return Layer.scoped(app, (ctx): Result<A, E2> | AsyncResult<A, E2> => {
    onReady?.(ctx);
    if (use !== undefined) return use(ctx);
    // No-`use` overload only: `A` is `void` and `E2` is `never` there, so the wait's
    // `AsyncResult<void, never>` is the honest type; the cast bridges the erased
    // implementation signature (the with-`use` overload never reaches this branch).
    return fromSafePromise(waitForShutdown(signals)) as unknown as AsyncResult<A, E2>;
  });
}) as RunHost;
