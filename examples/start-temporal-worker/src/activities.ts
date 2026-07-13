// The activity mount: a contract (zod I/O), the use case bound with `handler.use`, and the
// disposition map that turns each domain failure into a retryability decision (invariant B1) — a
// transient `PaymentUnavailable` is retryable (Temporal's policy retries), a permanent
// `PaymentDeclined` is non-retryable.
import { defineContract, handler } from "@btravstack/start-kernel";
import { createActivities, temporal } from "@btravstack/start-temporal";
import { Layer, Tag } from "demesne";
import { z } from "zod";

import { ChargeOrder } from "./application/use-cases.js";

export const CHARGE_ACTIVITY = "chargeOrder";

const ChargeContract = defineContract({
  input: z.object({ orderId: z.string(), amount: z.number().positive() }),
  output: z.object({ receiptId: z.string() }),
});

// A per-activity id (a run-tagged logger would live here too).
class ActivityId extends Tag("@app/ActivityId")<ActivityId, { readonly id: string }>() {}
const ActivityScopeLive = Layer.factory(ActivityId, () => ({ id: crypto.randomUUID() }));

export const ActivitiesLive = createActivities<ChargeOrder>()(ActivityScopeLive)
  .activity({
    name: CHARGE_ACTIVITY,
    handler: handler.use(ChargeContract, ChargeOrder, (charge, command) => charge(command)),
    errors: {
      "@app/PaymentUnavailable": () => temporal.retryable(),
      "@app/PaymentDeclined": (error) => temporal.nonRetryable(error.reason),
    },
  })
  .build();
