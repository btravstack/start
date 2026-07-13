# btravstack start — design spec (draft)

> Status: **draft / RFC.** This is the shape we're committing to, not yet the code.
> Voice and rigor mirror demesne's `CLAUDE.md`: state invariants, guard them, don't drift.
> Where this doc and future code disagree, one is a bug.

## Thesis

`btravstack start` is to a backend what TanStack Start is to a frontend: an **opinionated
application spine** you scaffold once and grow into. It does not invent a runtime. It
takes three things btravstack already believes in —

- **demesne** for wiring (the app is a `Layer` graph; everything discharged before you run),
- **unthrown** for error handling (no thrown control flow; typed error channels),
- **explicit contracts** for boundaries (schema-first input / output / error),

— and makes them the _only_ way to stand up a process. The payoff is that **12-factor
stops being a checklist and becomes a consequence**: build your app as a demesne graph
with a config Layer and lifecycle hooks, and disposability, config-in-env, stateless
processes, and dev/prod parity fall out for free (see §5).

One application graph. Three interchangeable **hosts** (api / amqp / temporal). The
business code never names its transport.

## 1. The unifying model — contract + injected handler + host

The reference architecture already exists in `examples/hono-prisma-api`. Its layering is
the model, with the transport isolated to one box:

```
domain/  application/   ← pure use cases + ports.ts   (no transport knowledge)
infra/                  ← adapters as demesne Layers   (prisma, logger, repository)
bootstrap.ts            ← the demesne composition       (bootstrap(repo) = test seam)
http/                   ← the ONLY transport-specific box (orpc contract → routes → hono)
```

Generalize the last box. Every transport is the **same shape**:

> a **contract** (schema-defined input / output / typed errors)
>
> - a **handler** (a demesne-injected use case returning an unthrown `AsyncResult`)
> - a **host** (owns the OS process; opens a `forkScope` per invocation)

What differs per transport is exactly two things, and nothing else:

1. **the adapter** that turns an external stimulus into a handler call
   (HTTP route ↔ AMQP consumer ↔ Temporal activity/workflow), and
2. **the invocation unit** for `forkScope` (per-request ↔ per-message ↔ per-activity).

Config, the DI graph, the unthrown error channel, and graceful shutdown are **shared**.
That shared part is the _kernel_.

### Load-bearing invariant #1 — the handler is transport-agnostic

A handler is `(input: In, ctx: Context<Needs>) => AsyncResult<Out, E>`. It never sees a
`Request`, a `Message`, or a Temporal `Context`. It cannot ack, nack, set a status code,
or schedule a retry. Those are host concerns (§6). If a handler needs transport metadata
(a correlation id, a delivery count), it arrives as a typed field on `In` that the host
populated — never as an ambient handle. _(This keeps the same use case runnable under all
three hosts and directly unit-testable with `new UseCase(ports).execute(input)`.)_

## 2. Package layout

```
packages/
  core/                 demesne                         (exists)
  start-kernel/         config + bootstrap conventions + lifecycle host + forkScope unit
  start-contract/       the zod-first contract DSL (§4) — transport-neutral core
  start-api/            orpc runtime      (extract from the example)  → HTTP host
  start-amqp/           amqp consumer host + ack/nack/DLQ disposition
  start-temporal/       temporal worker host + determinism guardrails
create-btravstack/      the scaffolder (the "start" CLI, TanStack-style)
examples/
  hono-prisma-api/      becomes the first consumer of start-kernel + start-api
```

> **As built:** `start-contract` was folded into `start-kernel` — the contract DSL
> (`defineContract` / `handler` / `runHandler` / `DispositionMap`) is small enough that a
> separate package added an artifact without adding a boundary. The rest of the layout landed
> as sketched (plus per-transport example apps beside `hono-prisma-api`).

Publishing namespace: `@btravstack/*` (already owned — cf. `@btravstack/theme`).
`unthrown` and `demesne` are **peer** dependencies of every `start-*` package, tracked in
lockstep exactly as demesne pins `unthrown ^4.1`.

## 3. The kernel (`@btravstack/start-kernel`)

The kernel is the process spine every host reuses. It owns:

- **Config** — `defineConfig(schema)` reads and validates `process.env` **once** into a
  `Config` Tag/Layer (promotes the example's `config/env.ts`). Business code injects
  `Config`; it never touches `process.env`. _(Factor III.)_
- **Bootstrap convention** — the app graph is a function `bootstrap(adapters) → Layer<App, E, never>`
  so the volatile adapters stay parameters (demesne's test seam, invariant #10 of the
  parent spec). The kernel does not auto-wire; it standardizes the _signature_, not the wiring.
- **Lifecycle host** — `runHost({ app, host, signals })`:
  1. `scoped(app, async (ctx) => …)` builds the graph once (`onStart` FIFO runs post-build),
  2. hands the built parent `ctx` to the transport host, which serves,
  3. holds the `use` promise open until a shutdown signal (SIGTERM/SIGINT),
  4. on signal, stops accepting new invocations, drains in-flight ones, then closes the
     scope — `onStop` / `acquireRelease` finalizers run **LIFO**. _(Factor IX.)_
- **Invocation unit** — a thin `forkScope(parent, requestLayer, use)` wrapper the host calls
  **once per invocation**, giving each request/message/activity its own instances and its own
  LIFO teardown, parent untouched (parent-spec invariant #12). _(Factor VI.)_

### Load-bearing invariant #2 — the kernel never resolves order at runtime

Same as demesne's "no auto-wiring" constraint. The kernel standardizes _where_ wiring
happens (`bootstrap`) and _when_ lifecycle runs (`runHost`), but the graph is still
hand-threaded with `provideTo` / `merge` and fully type-checked. A missing dependency is a
compile error, not a boot-time throw. Do not add a registry, decorator scanning, or a
resolve-and-retry loop.

## 4. The contract DSL (`@btravstack/start-contract`) — zod-first, orpc-shaped

**Decision:** one contract DSL, authored in zod, shaped like `@orpc/contract`, reused
across all three transports. `@orpc/contract` is used _directly_ for the api host; the amqp
and temporal contracts are our own zod packages that mirror its ergonomics so a reader
learns one shape.

A contract is a **transport-neutral triple** — input schema, output schema, and an
**explicit typed error set** — plus a transport-specific binding.

```ts
// transport-neutral core
const CreateTodo = contract({
  input: z.object({ title: z.string().min(1) }),
  output: Todo, // a zod schema
  errors: { TitleTaken: z.object({ title: z.string() }) }, // → unthrown TaggedError union
});
```

The `errors` record is the crux: it is the **static union** that becomes the handler's
`E` in unthrown terms, and each host maps those tagged errors to its own disposition (§6).
This is the same discipline as demesne — the error surface is declared at the boundary and
discharged, never thrown.

Per-transport binding specializes the triple:

```ts
// api  — verb + path (orpc)
api.route(CreateTodo, { method: "POST", path: "/todos" });

// amqp — queue + routing key + retry policy
amqp.consumer(CreateTodo, { queue: "todos.create", retries: 5, dlq: "todos.dlq" });

// temporal — activity or workflow, with timeouts/retry owned by Temporal
temporal.activity(CreateTodo, { startToClose: "30s" });
```

### Load-bearing invariant #3 — the contract owns the error set, the host owns the disposition

A contract enumerates _what can go wrong_ (the `errors` record → an unthrown tagged union).
It does **not** decide _what happens next_ — that is transport policy (return 409 / nack to
DLQ / signal a Temporal retry). Keep these separate: the same `TitleTaken` error is a 409
under api and a permanent-failure-to-DLQ under amqp, decided by the host's error map, not
the contract. _(Guards against baking HTTP status codes into business contracts.)_

## 5. 12-factor → demesne primitives (the differentiator)

Not a slogan — the primitives already exist. This table is the marketing _and_ the spec.

| Factor                           | Realized by                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| III Config                       | `defineConfig(schema)` → a `Config` Layer, env read+validated once, injected everywhere  |
| VI Stateless processes           | `forkScope` per invocation — no mutable state shared across requests/messages            |
| VIII Concurrency (process types) | each host is a process type over the **same** built parent graph                         |
| IX Disposability                 | `scoped` + `onStop` / `acquireRelease` LIFO teardown; host drains then closes on SIGTERM |
| X Dev/prod parity                | the `bootstrap(adapters)` seam — same graph, swap the volatile adapter for a fake        |
| XI Logs as event streams         | `Logger` as a Layer, stdout only; the host adds no log sink                              |

Factors I/II/IV/V/VII (codebase, deps, backing services, build/release/run, port binding)
are repo/deploy conventions the scaffolder encodes, not runtime primitives.

## 6. Per-transport error→disposition — the real design tension

The transports diverge on invocation semantics, and a naïve "handler returns `AsyncResult`,
done" abstraction breaks here. Each host needs an **explicit** error→disposition map. Making
it explicit is on-brand (contracts, robustness, everything discharged before you run).

- **api (orpc).** req→res. `Ok` → 2xx body; each tagged `Err` → a declared status + body via
  `@unthrown/orpc`. Errors return to the caller. No redelivery concept.
- **amqp.** fire-and-consume. The error surface is **ack / nack / requeue / DLQ**, not a
  response. An `Err` is not "return to caller"; it is "which disposition?" — a _transient_
  error nacks-with-requeue up to the policy limit; a _permanent_ error dead-letters. The host
  needs an error→disposition map (`{ TitleTaken: "dlq", Unavailable: "requeue" }`), plus
  **idempotency** (redelivery is expected) as a first-class concern the api host never has.
- **temporal.** durability inverts control. Retries, timeouts, and backoff are the
  **runtime's** job, configured on the binding, not coded in the handler. An `Err` in an
  activity means "let Temporal's retry policy decide" (retryable) vs "fail the activity
  permanently" (non-retryable) — again an error→disposition map, but the dispositions are
  Temporal's. Workflows must be **deterministic**: the determinism guardrail is that a
  workflow's demesne graph may inject only pure/deterministic services (I/O lives in
  activities). This is a real constraint the kernel must enforce or at least lint.

### Load-bearing invariant #4 — every host has a total error map

For a given contract, a host must map **every** member of the contract's `errors` union to a
disposition — no default-swallow. A missing arm is a compile error (the union is known
statically). This mirrors demesne's "build only when `Needs` is `never`": you cannot start a
host until every declared failure has a decided disposition.

## 7. Open questions (decide before/while building the kernel)

1. **Contract authoring surface.** Confirm the zod-first triple (§4) covers streaming
   (orpc streams, amqp is naturally streaming, temporal signals/queries). Do signals/queries
   need a second contract kind, or are they just more triples?
2. **Idempotency primitive.** amqp (and temporal, on replay) need it. Is it a kernel-provided
   `Idempotent` port (keyed store) injected into handlers, or host middleware? Leaning: a port,
   so it's testable and transport-neutral.
3. **Determinism enforcement for temporal.** Lint-only, a marker type on services
   (`Deterministic` phantom in `Needs`, à la `Scope`), or runtime? A phantom requirement is the
   most demesne-native answer and worth prototyping.
4. **Does this stay in the demesne repo or split out?** The example lives here; `start-*` could
   grow here first and split when it stabilizes. No decision needed yet.
5. **Scaffolder scope.** `create-btravstack` picks transports and emits the `bootstrap` +
   host + one example contract per chosen transport. Later.

## 8. First slice (per the design-first decision)

This document _is_ the first slice. The implementation order that follows from it:

1. `start-kernel` — extract `defineConfig`, `bootstrap` convention, `runHost`, invocation
   `forkScope`, from `hono-prisma-api`; leave the example as its first consumer.
2. `start-contract` + `start-api` — promote the example's `http/` box; nothing new, just
   packaged and re-pointed at the kernel.
3. `start-amqp` — the transport that most stresses §6 (ack/nack/DLQ + idempotency). Build it
   as a second example to validate that the kernel abstraction actually holds.
4. `start-temporal` — last, because determinism (§7.3) is the hardest guardrail.
5. `create-btravstack` — once two transports share a real kernel.
