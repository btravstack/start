# @demesne-examples/start-temporal-worker

A complete Temporal worker on **btravstack start** — the _same_ charge domain as the AMQP example,
run as a Temporal **activity**, with a **real @temporalio worker** and a deterministic workflow.

```
config.ts               defineConfig(schema)                       — factor III
domain.ts               charge domain (identical to the AMQP example)
application/             Payments port · ChargeOrder use case
infra/payments.ts       demo Payments adapter (swappable)
activities.ts           defineContract + handler.use + createActivities + disposition map
infra/temporal.ts       REAL adapter: TemporalActivityFailure → ApplicationFailure
workflow.ts             a deterministic workflow (proxyActivities — no DI)
worker.ts               build the registry + Worker.create + worker.run()
```

## What it shows

- **The disposition map is the retry policy.** `PaymentUnavailable` (transient) → `retryable`
  (Temporal's policy retries), `PaymentDeclined` (permanent) → `nonRetryable`. The handler never
  decides retry — durability inverts control to the runtime.
- **One error adapter is the only Temporal-specific glue.** `infra/temporal.ts` maps our
  `TemporalActivityFailure` to `@temporalio`'s `ApplicationFailure({ nonRetryable })`.
- **Determinism by construction.** `workflow.ts` is handed only typed activity proxies, never a
  demesne context — I/O can't reach it, so it stays deterministic. No `Deterministic` marker needed.
- **Same domain, different transport.** The `charge` use case is identical to the AMQP example's;
  only the host changes.

## Run

```sh
# a Temporal dev server (see https://docs.temporal.io), then:
pnpm --filter @demesne-examples/start-temporal-worker dev    # worker.ts
pnpm --filter @demesne-examples/start-temporal-worker test   # seam test — no cluster needed
```

The tests invoke the activity functions directly (and assert the real `ApplicationFailure`
mapping); `worker.ts` compiles against `@temporalio/worker` and is what a live worker runs.

## Integration test

`pnpm --filter @demesne-examples/start-temporal-worker test:integration` — the REAL
@temporalio Worker against a real Temporal dev server via testcontainers (Docker required):
the bundled deterministic workflow executes through the demesne-wired activity, and a declined
charge fails the workflow immediately (non-retryable short-circuits the retry policy).
