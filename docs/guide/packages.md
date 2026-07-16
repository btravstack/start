# Packages

All packages are currently `private` while the API settles — see [Status](/guide/status).

## `@btravstack/start-kernel`

The spine. Everything the hosts share lives here, once:

- `defineConfig` — environment read and validated at the boundary (factor III)
- `runHost` — process ownership and graceful shutdown (factor IX)
- `defineContract` / `handler` / `runHandler` — the contract-to-use-case binding
- `DispositionMap` / `dispatch` — total outcome-to-transport mapping

## `@btravstack/start-api`

HTTP host on [Hono](https://hono.dev): `createHttpApp` + `httpListener`.

## `@btravstack/start-amqp`

AMQP host: settlement dispositions over a wire `AmqpDriver`, with an optional `IdempotencyStore`
for redelivery.

## `@btravstack/start-temporal`

Temporal host: activities as demesne-wired use cases; determinism enforced structurally —
workflows get activity proxies, never a container.
