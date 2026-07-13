# @btravstack/start-amqp

> Incubating. The AMQP host for **btravstack start** — the transport that most stresses the
> kernel seam. See `design/btravstack-start*.md` at the repo root.

Consume demesne-wired contracts. Each message forks its own scope, validates its body against
the contract, dispatches to the handler, and decides a **broker disposition** — `ack`,
`requeue`, or `deadLetter`. Unlike HTTP (req→res), the error surface is settlement, so the
disposition map is where _transient⇒requeue_ vs _permanent⇒deadLetter_ is decided per error.
Redelivery is expected, so an optional `IdempotencyStore` dedupes by message id — the concern
the HTTP host never has. Pure transport glue over `@btravstack/start-kernel`.

```ts
const router = createConsumer<AppServices>()(RequestScopeLive)
  .consume({
    queue: "todos.create",
    handler: handler.use(CreateTodoContract, CreateTodo, (create, input) => create(input.title)),
    errors: {
      "@app/Unavailable": () => amqp.requeue(), // transient → retry
      "@app/AmountRejected": (e) => amqp.deadLetter(e.reason), // permanent → DLQ
    },
  })
  .build(); // Layer<MessageRouter, never, AppServices>

// run the consume loop as a resource, torn down on shutdown:
const graph = Layer.merge(
  router,
  Layer.provideTo(runConsumer({ driver, queues: ["todos.create"], idempotency }), router),
);
await runHost(graph);
```

## Surface

- **`createConsumer<Parent>()(requestLayer)`** — a builder; `.consume(spec)` binds a queue to a
  contract+handler+disposition-map, `.build()` yields a `MessageRouter` service (queue → settle
  decision).
- **`runConsumer({ driver, queues, idempotency? })`** — the consume loop as an `acquireRelease`
  resource over a wire `AmqpDriver`; cancels subscriptions on shutdown.
- **`amqp.ack() / requeue() / deadLetter(reason?)`** — build a settlement disposition.
- **`AmqpDriver` / `AmqpDelivery` / `IdempotencyStore`** — the seams a broker adapter (amqplib)
  and a dedupe store (Redis/Postgres) implement. No broker dependency is bundled.

## Triage defaults

`Ok` → ack. A kernel `ContractError` (bad bytes) → dead-letter (a retry can't fix it). A domain
error → the route's total map. An unmapped tag or request-scope build error → requeue (assume
transient). A defect (thrown bug) → dead-letter (don't poison-loop the queue).
