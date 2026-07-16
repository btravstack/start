# The idea

Your application is a **demesne graph** — pure use cases behind ports, adapters wired at the
boundary, everything discharged before you run. start adds the process spine and lets you serve
that _same graph_ over any transport.

Every invocation, whatever the transport, is the same triple:

> a **contract** (zod input / output) + a **handler** (a demesne-injected use case) + a **host**
> (owns the process, opens a fork scope per invocation)

The host is the only thing that changes between transports. Config, the DI graph, the error
channel, and graceful shutdown are shared.

## Why "12-factor falls out"

The kernel makes the classic [12-factor](https://12factor.net) disciplines structural rather than
aspirational:

- **Factor III (config)** — `defineConfig` reads the environment once, validated, at the boundary.
  Nothing deeper in the graph touches `process.env`.
- **Factor IX (disposability)** — `runHost` owns startup and graceful shutdown. Resources are
  scoped by demesne and released LIFO; a fork scope opens per invocation and closes with it.
- **Ports and adapters** — use cases stay pure behind `Context<R>` signatures; transports are
  adapters at the edge, not callers woven through your domain.

## Dispositions

A handler doesn't know its transport, so it can't speak HTTP statuses or AMQP acks. It returns a
typed outcome; each host maps outcomes to its transport's vocabulary through a **total
`DispositionMap`** — total meaning the compiler insists every outcome is mapped:

| Host                         | Disposition `D`             | Invocation unit |
| ---------------------------- | --------------------------- | --------------- |
| `@btravstack/start-api`      | HTTP status                 | per request     |
| `@btravstack/start-amqp`     | ack / requeue / dead-letter | per message     |
| `@btravstack/start-temporal` | retryable / non-retryable   | per activity    |

## Relationship to demesne

[demesne](https://btravstack.github.io/demesne/) is a standalone, unbranded DI library; start
depends on it as a published package — a one-way dependency (demesne knows nothing of start). They
evolve independently.

## Where the design lives

The RFCs in [`design/`](https://github.com/btravstack/start/tree/main/design) are the source of
truth (invariant-driven): the thesis, the kernel API, and the handler binding. While start is
incubating, read those before reading code.
