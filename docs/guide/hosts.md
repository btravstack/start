# Hosts

A **host** owns the process for one transport: it opens the listener or consumer, opens a demesne
fork scope per invocation, runs the handler through the kernel's `runHandler`, and maps the
outcome to the transport's vocabulary through a total `DispositionMap`.

Hosts contain **no DI, lifecycle, validation, or dispatch logic of their own** — that all lives in
the kernel, once. A host is pure transport glue.

| Host                         | Transport                       | Disposition `D`             | Invocation unit |
| ---------------------------- | ------------------------------- | --------------------------- | --------------- |
| `@btravstack/start-api`      | HTTP ([Hono](https://hono.dev)) | HTTP status                 | per request     |
| `@btravstack/start-amqp`     | AMQP / RabbitMQ                 | ack / requeue / dead-letter | per message     |
| `@btravstack/start-temporal` | [Temporal](https://temporal.io) | retryable / non-retryable   | per activity    |

## HTTP — `@btravstack/start-api`

`createHttpApp` + `httpListener`: contracts become routes, handler outcomes become statuses. The
listener owns startup and graceful shutdown of the Node server.

## AMQP — `@btravstack/start-amqp`

Settlement dispositions (ack, requeue, dead-letter) over a wire `AmqpDriver`, with an optional
`IdempotencyStore` for redelivery — a message seen twice runs the use case once.

## Temporal — `@btravstack/start-temporal`

Activities as demesne-wired use cases. Determinism is enforced **structurally**: workflows receive
activity proxies, never a container, so a workflow cannot accidentally reach non-deterministic
code.
