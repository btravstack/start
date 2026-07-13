# btravstack start

> **Type-safe, 12-factor backend applications: one demesne graph, many transport hosts.**
> TanStack Start, but for a backend. [demesne](https://github.com/btravstack/demesne) does the
> wiring, [unthrown](https://github.com/btravstack/unthrown) carries the errors, and 12-factor
> falls out of building your app as a graph.

Incubating. All packages are currently `private` while the API settles.

## The idea

Your application is a **demesne graph** — pure use cases behind ports, adapters wired at the
boundary, everything discharged before you run. btravstack start adds the process spine and lets
you serve that _same graph_ over any transport:

> a **contract** (zod input / output) + a **handler** (a demesne-injected use case) + a **host**
> (owns the process, opens a fork scope per invocation)

The host is the only thing that changes between transports. Config, the DI graph, the error
channel, and graceful shutdown are shared.

| Host                         | Disposition `D`             | Invocation unit |
| ---------------------------- | --------------------------- | --------------- |
| `@btravstack/start-api`      | HTTP status                 | per request     |
| `@btravstack/start-amqp`     | ack / requeue / dead-letter | per message     |
| `@btravstack/start-temporal` | retryable / non-retryable   | per activity    |

Each host is **pure transport glue** over the kernel's `runHandler` + a total `DispositionMap` —
no DI, lifecycle, validation, or dispatch logic of its own.

## Packages

- **`@btravstack/start-kernel`** — the spine: `defineConfig` (factor III), `runHost` (factor IX),
  `defineContract` / `handler` / `runHandler`, and `DispositionMap` / `dispatch`.
- **`@btravstack/start-api`** — HTTP host (Hono): `createHttpApp` + `httpListener`.
- **`@btravstack/start-amqp`** — AMQP host: settlement dispositions over a wire `AmqpDriver`, with
  an optional `IdempotencyStore` for redelivery.
- **`@btravstack/start-temporal`** — Temporal host: activities as demesne-wired use cases;
  determinism enforced structurally (workflows get activity proxies, never a container).

## Examples

Each is a complete app with a `test:integration` suite that runs against **real infrastructure**
via [testcontainers](https://testcontainers.com):

- **`start-api-todo`** — plain HTTP + in-memory repo (the base example).
- **`start-orpc-prisma`** — a typed oRPC API backed by Prisma/Postgres.
- **`start-amqp-worker`** — a RabbitMQ consumer via a real amqplib driver.
- **`start-temporal-worker`** — a Temporal worker + deterministic workflow.

## Design

The RFCs in [`design/`](./design) are the source of truth (invariant-driven, in the spirit of
demesne's `CLAUDE.md`): the thesis, the kernel API, and the handler binding.

## Develop

```sh
pnpm install
pnpm typecheck && pnpm test      # unit + type-level
pnpm test:integration            # testcontainers — needs Docker
pnpm lint && pnpm format --check && pnpm knip
```

## Relationship to demesne

`demesne` is a standalone, unbranded DI library; btravstack start depends on it as a published
package (a one-way dependency — demesne knows nothing of start). They evolve independently. When
co-developing both, point `demesne` at your local checkout with a pnpm override.
