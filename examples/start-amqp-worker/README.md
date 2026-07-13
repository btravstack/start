# @demesne-examples/start-amqp-worker

A complete AMQP consumer on **btravstack start** — a demesne-wired charge use case consumed from
RabbitMQ, with a **real amqplib driver**.

```
config.ts               defineConfig(schema)                       — factor III
domain.ts               charge domain + transient/permanent errors
application/             Payments port · ChargeOrder use case
infra/payments.ts       demo Payments adapter (swappable)
infra/amqp-driver.ts    REAL amqplib AmqpDriver (connect/consume/ack/nack)
consumer.ts             defineContract + handler.use + createConsumer + disposition map
bootstrap.ts            bootstrap(payments)                        — the test seam
server.ts               connect broker + runConsumer + runHost
```

## What it shows

- **The disposition map is the ack/nack policy.** `PaymentUnavailable` (transient) → `requeue`,
  `PaymentDeclined` (permanent) → `deadLetter`. A malformed message is a poison message →
  dead-letter. No settlement logic lives in the handler (invariant B1).
- **The wire driver is the only broker-specific code.** `infra/amqp-driver.ts` implements
  start-amqp's `AmqpDriver` seam against amqplib; everything else is transport-neutral.
- **Redelivery is expected** — pass an `IdempotencyStore` to `runConsumer` to dedupe by message id.

## Run

```sh
docker run -p 5672:5672 rabbitmq:3          # a broker
AMQP_URL=amqp://localhost pnpm --filter @demesne-examples/start-amqp-worker dev
pnpm --filter @demesne-examples/start-amqp-worker test   # seam test — no broker needed
```

The tests build the graph with a fake Payments and drive the `MessageRouter` directly (no broker);
the real amqplib driver compiles against amqplib's types and is what `server.ts` runs.

## Integration test

`pnpm --filter @demesne-examples/start-amqp-worker test:integration` — the full consume loop
against a real RabbitMQ via testcontainers (Docker required), through the real amqplib driver:
ack (drain), dead-letter for declined and malformed messages (no requeue loop), and
subscription cancellation on shutdown.
