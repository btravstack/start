# @btravstack/start-kernel — API surface (draft)

> Companion to `btravstack-start.md`. Status: **draft / RFC.** Every API below is a
> _promotion_ of a construct that already exists in `examples/hono-prisma-api` — the
> line references are real. The kernel adds no new runtime; it standardizes the spine
> so the three hosts share it. Signatures use demesne's real types: `Layer<P, E, N>`,
> `Context<R>`, `Tag`, `AsyncResult`, `scoped`, `forkScope`.

## 0. What promotes to what

| Today in the example                                         | Kernel API                                                     | File it comes from      |
| ------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------- |
| `config/env.ts` (zod → `Layer.make` → `AppConfig`)           | `defineConfig(schema)`                                         | `config/env.ts:10-33`   |
| `bootstrap(repository)` composition                          | _convention only_ — kernel fixes the signature, not the wiring | `bootstrap.ts:22-35`    |
| `server.ts` (`scoped` + `waitForShutdown` + `outcome.match`) | `runHost(app)`                                                 | `server.ts:13-43`       |
| `HttpServerLive` (`acquireRelease` listener)                 | a **host resource layer** the host package provides            | `http/server.ts:23-45`  |
| `HttpAppLive` + `forkScope` per request                      | `Host.invoke` (forkScope-per-invocation)                       | `http/routes.ts:94-126` |
| oRPC procedures + `handlerResult` + `mapErr`                 | `defineContract` + `defineHandler` + host error map            | `http/routes.ts:43-80`  |

The kernel is §1–§4. The host contract is §5. The contract/handler layer is §6.
Everything in §1–§4 is transport-neutral and reused verbatim by all three hosts.

## 1. `defineConfig` — factor III, one call

Promotes `config/env.ts`. Reads `process.env` through a zod schema **once, at the
edge**, and returns a Tag + a fallible `Layer.make` layer. The parse failure is a
standard `ConfigError` in the wiring error union — never a throw.

```ts
export interface ConfigModule<A> {
  readonly Config: Tag<ConfigTag<A>, A>;                     // inject this everywhere
  readonly ConfigLive: Layer<ConfigTag<A>, ConfigError, never>;
}

export class ConfigError extends TaggedError("@btravstack/ConfigError", …)<{
  readonly issues: string;
}> {}

export function defineConfig<S extends z.ZodType>(
  schema: S,
  opts?: { readonly source?: Record<string, string | undefined> },  // defaults to process.env
): ConfigModule<z.infer<S>>;
```

Usage — the example's 24 lines collapse to:

```ts
export const { Config, ConfigLive } = defineConfig(
  z.object({
    DATABASE_URL: z.string().startsWith("postgres"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn"]).default("info"),
  }),
);
```

**Invariant K1 — config is read once and injected, never ambient.** Business code
injects `Config`; it never touches `process.env`. `defineConfig` passes the whole env
object to zod (no property read off the index signature), exactly as `config/env.ts:31`.

## 2. The app graph — `bootstrap` stays hand-wired (convention, not API)

The kernel does **not** wire your graph (demesne's no-auto-wiring thesis holds). It only
fixes the _signature_ so hosts and tests agree:

```ts
// convention: the volatile adapters are parameters (the demesne test seam)
type Bootstrap<App, E, Adapters extends Layer<any, any, any>> = (
  adapters: Adapters,
) => Layer<App, E, Scope>;
```

This is literally `bootstrap.ts:22` today. The kernel ships a type alias and a lint, not a
builder. The graph is still composed by hand with `merge` / `provideTo`, single-pass and
fully type-checked; a missing dependency is a compile error.

## 3. `runHost` — the process loop (factor IX)

Promotes `server.ts` end to end. Given a fully-assembled `Layer<App, E, Scope>` (the host's
resource layer already merged in, §5), it:

1. `scoped(app, use)` — builds once; `onStart` hooks run post-build, before `use`;
2. runs `use` — **default**: block until a shutdown signal (`waitForShutdown`, `server.ts:13`);
3. on signal, resolves `use` → scope closes → `onStop` / `acquireRelease` finalizers LIFO
   (listener stops accepting, then Prisma disconnects);
4. returns the outcome as a typed `AsyncResult<A, E>` — the caller `match`es it, or the
   kernel exits non-zero on `Err`/`Defect` with a standard log line.

```ts
export function runHost<App, E, A = void>(
  app: Layer<App, E, Scope>,
  opts?: {
    readonly use?: (ctx: Context<App>) => AsyncResult<A, E>; // default: wait for SIGTERM/SIGINT
    readonly signals?: readonly NodeJS.Signals[]; // default: ["SIGINT", "SIGTERM"]
    readonly onReady?: (ctx: Context<App>) => void; // e.g. ctx.get(Logger).info("ready")
  },
): AsyncResult<A, E>;
```

**Invariant K2 — the scope's lifetime IS `use`.** No open/hold/close handle (demesne's "no
manual Scope handle"). A long-lived process keeps `use` pending until the signal, then
teardown runs. `runHost` never calls `build` — a resource graph carries `Scope`, so `build`
would be a compile error; only `scoped` can run it.

**Invariant K3 — `runHost` requires `Needs = Scope`, nothing more.** If the app graph still
needs a service, that's a compile error at the `runHost` call, not a boot-time throw.

## 4. Lifecycle & readiness are demesne hooks, not kernel machinery

Startup checks (`app.ts:41` `onStart`), resource acquisition (`acquireRelease`), and
shutdown steps (`onStop`) are attached with the demesne combinators the app already uses.
The kernel adds nothing here — it just guarantees `runHost` runs `onStart` before `use` and
finalizers after, which `scoped` already does. Documented so no one reinvents it.

## 5. The `Host` contract — the transport seam

A host is **not** the process loop (that's `runHost`). A host is three things a transport
package provides, so the _same_ app graph can be served over api / amqp / temporal:

```ts
export interface Host<App, In, Out, E> {
  readonly name: string;

  /** The transport resource: acquires the listener/consumer/worker, releases on scope close.
   *  Merged into the app graph so it lives under runHost's scope. (cf. HttpServerLive) */
  resource(handlers: ReadonlyArray<BoundHandler<App, In, Out, E>>): Layer<any, E, App | Scope>;

  /** Open a per-invocation forkScope off the built parent, run the handler, close it.
   *  Called once per request/message/activity. (cf. http/routes.ts:104 forkScope) */
  invoke(
    parent: Context<App>,
    requestLayer: Layer<any, any, App | Scope>,
    handler: BoundHandler<App, In, Out, E>,
    stimulus: In,
  ): AsyncResult<Out, E>;
}
```

**Invariant K4 — the host owns transport; the handler never sees it.** `invoke` is where
`forkScope` happens; the handler receives typed `In` + the fork `Context`, and returns
`AsyncResult<Out, E>`. It cannot ack/nack/set-status (RFC invariant #1). The three hosts
differ _only_ in `resource` (what they acquire) and how they translate an `Err` into a
transport disposition (§6, RFC §6).

## 6. `defineContract` / `handler` — the zod-first, transport-neutral boundary

> **The binding is worked out in full in `btravstack-start-handler-binding.md`.** Read that
> for the resolution; two corrections it makes to this section: (1) `Contract.errors` is the
> **domain** error union, _not_ transport codes — the example below reused a tag as both,
> which is wrong; and (2) `defineHandler` is renamed `handler`, gains a `handler.use` sugar
> for single-service edges, and its `R` is bounded by `App | request-scope provisions` (B2).

Promotes the oRPC procedure shape (`http/routes.ts:43-80`) into a transport-neutral triple
(RFC §4). The contract owns the **domain error set**; the host owns the **disposition**.

```ts
export interface Contract<In, Out, Errors extends TaggedErrorMap> {
  readonly input: z.ZodType<In>;
  readonly output: z.ZodType<Out>;
  readonly errors: Errors; // the use case's DOMAIN TaggedError union — = handler's E, = the map's domain
}

export function defineContract<
  S extends z.ZodType,
  O extends z.ZodType,
  Errors extends TaggedErrorMap,
>(spec: { input: S; output: O; errors: Errors }): Contract<z.infer<S>, z.infer<O>, Errors>;

/** Bind a contract to the transport edge, shaped like a demesne `factory`: (input, ctx) =>
 *  AsyncResult<Out, DomainErrors>. `ctx` is the FORK context; the handler reads the use case
 *  (built by the graph) plus any request-scoped services off it and dispatches — it does not
 *  re-inject, and it returns the DOMAIN error union untranslated (the mount maps it). `R` is
 *  bounded by App | request-scope provisions (B2). See the handler-binding doc. */
export function handler<In, Out, DomainErrors, R>(
  contract: Contract<In, Out, DomainErrors>,
  handle: (input: In, ctx: Context<R>) => AsyncResult<Out, ErrorValue<DomainErrors>>,
): BoundHandler<R, In, Out, ErrorValue<DomainErrors>>;

// sugar for the single-service edge — `handler` with ctx.get(tag) pre-applied:
//   handler.use(GetTodoContract, GetTodo, (uc, input) => uc.execute(input.id))
```

The **disposition map** is where transports diverge, and it is _total_ (RFC invariant #4 —
every declared error mapped, or compile error):

```ts
// api — Err → HTTP status (this is today's mapErr → errors.CODE, http/routes.ts:59)
api.mount(app, [
  handler(getTodo, {
    TodoNotFound: (e) => api.notFound(),
    RepositoryError: (e) => api.status("STORAGE_FAILED"),
  }),
]);

// amqp — Err → ack disposition (the concern api never has)
amqp.consumer(app, [
  handler(processPayment, {
    Unavailable: () => amqp.requeue(), // transient → nack+requeue (retry policy)
    AmountRejected: (e) => amqp.deadLetter(e), // permanent → DLQ
  }),
]);

// temporal — Err → retryability (dispositions are Temporal's)
temporal.activities(app, [
  handler(chargeCard, {
    Unavailable: () => temporal.retryable(), // let Temporal's policy retry
    CardDeclined: () => temporal.nonRetryable(), // fail the activity permanently
  }),
]);
```

**Invariant K5 — one contract, one error union, three total maps.** The same
`Contract`'s `errors` record drives all three; a host cannot be mounted until every arm has
a disposition. This is the compile-time analog of "build only when `Needs` is `never`":
you cannot start a host with an undecided failure.

## 7. api host (`@btravstack/start-api`) — thin over what exists

Almost entirely a repackaging of `http/routes.ts` + `http/server.ts`:

- `resource()` = `HttpServerLive` generalized (the Node listener as `acquireRelease`).
- `invoke()` = the `app.all("*")` middleware's `forkScope(ctx, RequestScopeLive, …)`.
- the disposition map = the per-procedure `mapErr(err => errors.CODE())` triage.
- oRPC + `@unthrown/orpc` `handlerResult` give the end-to-end typed client for free.

Net new code in this package is near zero; it's the proof the kernel seam fits reality.

## 8. amqp host (`@btravstack/start-amqp`) — where the seam is tested

New, and the transport that validates the abstraction (RFC §8 step 3):

- `resource()` acquires the connection + channel + consumer, releases on scope close (an
  `acquireRelease`, same discipline as the listener).
- `invoke()` opens a `forkScope` per **message** — fresh correlation id / message-scoped
  logger, closed when the message settles.
- the disposition map returns `ack` / `requeue` / `deadLetter`, and the host applies it
  (nack semantics, retry counter, DLQ routing) — the handler stays oblivious.
- **idempotency** (RFC §7.2) surfaces here: a kernel-provided `Idempotent` port injected
  into the handler, keyed by message id, so redelivery is safe and testable. Proposed as a
  port (transport-neutral) rather than host middleware.

## 9. What is deliberately NOT in the kernel

- **No wiring.** `bootstrap` is hand-composed. The kernel fixes its type, not its body.
- **No registry / decorators / reflection.** Handlers are bound explicitly and passed to a
  host as an array. (demesne's "do not adopt" list.)
- **No Scope handle.** Lifetime is `use`; `runHost` owns it.
- **No transport leakage into handlers.** A handler is `(In, Context) => AsyncResult`, full
  stop. If it needs a correlation id, it's a typed `In` field the host filled.
- **No default error swallow.** Every host mount demands a total disposition map (K5).

## 10. Build order (unchanged from RFC §8)

1. `start-kernel` — `defineConfig`, `runHost`, the `Host` interface, `defineContract` /
   `defineHandler`. Extract from `hono-prisma-api`; leave the example as its consumer.
2. `start-api` — repackage `http/`; near-zero new code (§7).
3. `start-amqp` — first real second host; validates the seam (§8).
4. `start-temporal` — last; determinism guardrail (RFC §7.3) is the open risk.
