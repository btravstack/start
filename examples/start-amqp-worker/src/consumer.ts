// The consumer mount: a contract (zod I/O), the use case bound with `handler.use`, and the
// disposition map that turns each domain failure into a broker settlement — the AMQP-specific
// translation (invariant B1): a transient `PaymentUnavailable` requeues (retry), a permanent
// `PaymentDeclined` dead-letters.
import { amqp, createConsumer, MessageRouter } from "@btravstack/start-amqp";
import { defineContract, handler } from "@btravstack/start-kernel";
import { Layer, Tag } from "demesne";
import { z } from "zod";

import { ChargeOrder } from "./application/use-cases.js";

export const CHARGE_QUEUE = "orders.charge";

const ChargeContract = defineContract({
  input: z.object({ orderId: z.string(), amount: z.number().positive() }),
  output: z.object({ receiptId: z.string() }),
});

// A per-message id (a message-tagged logger would live here too).
class MessageId extends Tag("@app/MessageId")<MessageId, { readonly id: string }>() {}
const MessageScopeLive = Layer.factory(MessageId, () => ({ id: crypto.randomUUID() }));

export { MessageRouter };

export const ConsumerLive = createConsumer<ChargeOrder>()(MessageScopeLive)
  .consume({
    queue: CHARGE_QUEUE,
    handler: handler.use(ChargeContract, ChargeOrder, (charge, command) => charge(command)),
    errors: {
      "@app/PaymentUnavailable": () => amqp.requeue(),
      "@app/PaymentDeclined": (error) => amqp.deadLetter(error.reason),
    },
  })
  .build();
