# @btravstack/start-temporal

> Incubating. The Temporal host for **btravstack start** — the third host, where durability
> inverts control. See `design/btravstack-start*.md` at the repo root.

Run demesne-wired contracts as Temporal **activities**. Each activity invocation forks its own
scope, validates input against the contract, dispatches to the handler, and — because the
runtime owns retries/timeouts, not the handler — maps a domain error to a **retryability**
decision (`retryable` vs `nonRetryable`) at the mount. Pure transport glue over
`@btravstack/start-kernel`.

```ts
const registry = createActivities<AppServices>()(RequestScopeLive)
  .activity({
    name: "chargeCard",
    handler: handler.use(ChargeContract, ChargeCard, (charge, input) => charge(input)),
    errors: {
      "@app/Unavailable": () => temporal.retryable(), // let Temporal retry
      "@app/CardDeclined": (e) => temporal.nonRetryable(e.reason), // permanent
    },
  })
  .build(); // Layer<ActivityRegistry, never, AppServices>

// hand the activities to a Temporal worker (adapter injects @temporalio):
const { activities } = ctx.get(ActivityRegistry);
// new Worker({ taskQueue, activities, workflowsPath });
```

## Surface

- **`createActivities<Parent>()(requestLayer)`** — a builder; `.activity(spec)` binds a named
  activity to a contract+handler+disposition-map, `.build()` yields an `ActivityRegistry`
  service (a record of activity functions ready for a Temporal worker).
- **`temporal.retryable() / nonRetryable(reason?)`** — build a retryability disposition.
- **`TemporalActivityFailure`** — the boundary error an activity throws on failure, carrying
  `retryable`. A worker adapter maps `!retryable` to `ApplicationFailure.create({ nonRetryable })`.

## Determinism — enforced by construction, not a marker

The RFC flagged workflow determinism as the open risk (a `Deterministic` phantom in `Needs`).
The resolution is structural and needs no phantom: **demesne integrates on the activity side
only.** Activities do I/O — that is their purpose — so a normal demesne-wired use case is
exactly right. **Workflows** must be deterministic, and they stay so _because they are handed
activity proxies, never a demesne context_ — I/O simply cannot reach a workflow body. You can't
break determinism by injecting a service into a workflow because you are never given one to
inject. (This is also why workflows don't use the container: replay-determinism requires every
input to arrive through Temporal's deterministic APIs, not a runtime graph.)

## Triage defaults

`Ok` → return output. A kernel `ContractError` (bad input) → non-retryable (a retry can't fix
it). A domain error → the route's total map. An unmapped tag or request-scope build error →
retryable (assume transient infra). A defect (thrown bug) → non-retryable.
