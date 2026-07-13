// The consume loop as a demesne RESOURCE, plus the wire-driver seam. `runConsumer` subscribes the
// `MessageRouter` to a broker via a minimal `AmqpDriver` interface (implemented by a real amqplib
// adapter, or a fake in tests — no broker dependency here) and, being an `acquireRelease`, carries
// `Scope`: subscriptions are cancelled on shutdown (factor IX). Redelivery is expected on AMQP, so
// an optional `IdempotencyStore` dedupes by message id — the concern api never has.

import { type Context, Layer, type Scope, type ServiceOf, Tag } from "demesne";
import { fromPromise, TaggedError } from "unthrown";

import { type AmqpDisposition, amqp } from "./disposition.js";
import { MessageRouter } from "./router.js";

// One delivery handed up from the broker. `messageId` drives idempotent redelivery when present.
export type AmqpDelivery = {
  readonly queue: string;
  readonly messageId?: string;
  readonly body: unknown;
};

export type AmqpSubscription = { readonly cancel: () => Promise<void> };

// The wire seam: subscribe a settle callback to a queue; the driver applies each returned
// disposition (ack / requeue / dead-letter) to the broker. A real amqplib adapter implements this.
export type AmqpDriver = {
  readonly consume: (
    queue: string,
    onDelivery: (delivery: AmqpDelivery) => Promise<AmqpDisposition>,
  ) => Promise<AmqpSubscription>;
};

// A dedupe store for at-least-once redelivery: `seen` reports whether a message id was already
// processed; `record` marks one processed. A real store is Redis/Postgres-backed with a TTL.
export type IdempotencyStore = {
  readonly seen: (messageId: string) => Promise<boolean>;
  readonly record: (messageId: string) => Promise<void>;
};

// The service carries its own subscriptions: they are PER-BUILD state (created in acquire, read
// by release), so a layer reference built in two scopes gets two independent subscription sets —
// demesne's "separate builds reconstruct" contract — and closing one scope cannot cancel the
// other's consumers.
export class Consumer extends Tag("@btravstack/start-amqp/Consumer")<
  Consumer,
  { readonly queues: readonly string[]; readonly subscriptions: readonly AmqpSubscription[] }
>() {}

export class ConsumeError extends TaggedError("@btravstack/start-amqp/ConsumeError", {
  name: "ConsumeError",
})<{
  readonly cause: unknown;
}> {}

// Route one delivery: skip (ack) a duplicate, else dispatch and record on success. Total — it
// never rejects, so a driver that calls it without awaiting can't cause an unhandled rejection.
// The failure handling is deliberately ASYMMETRIC around the point of processing:
//   • `seen` (or dispatch) fails BEFORE anything happened → requeue; a retry is safe.
//   • `record` fails AFTER the message was successfully processed → still ACK. Requeuing here
//     would guarantee a duplicate execution (redelivered, and — unrecorded — reprocessed), which
//     is the exact failure the store exists to prevent; at-least-once semantics were already
//     accepted, so losing one dedupe record is the cheaper failure.
const deliver = async (
  router: ServiceOf<MessageRouter>,
  delivery: AmqpDelivery,
  store: IdempotencyStore | undefined,
): Promise<AmqpDisposition> => {
  const id = store !== undefined ? delivery.messageId : undefined;

  let disposition: AmqpDisposition;
  try {
    if (store !== undefined && id !== undefined && (await store.seen(id))) return amqp.ack();
    disposition = await router.dispatch(delivery.queue, delivery.body);
  } catch {
    return amqp.requeue(); // nothing was processed yet — safe to retry
  }

  if (store !== undefined && id !== undefined && disposition.kind === "ack") {
    try {
      await store.record(id);
    } catch {
      // processed successfully — ack anyway; see the asymmetry note above.
    }
  }
  return disposition;
};

export const runConsumer = (opts: {
  readonly driver: AmqpDriver;
  readonly queues: readonly string[];
  readonly idempotency?: IdempotencyStore;
}): Layer<Consumer, ConsumeError, MessageRouter | Scope> =>
  Layer.acquireRelease(
    Consumer,
    (ctx: Context<MessageRouter>) =>
      fromPromise(
        (async (): Promise<ServiceOf<Consumer>> => {
          const router = ctx.get(MessageRouter);
          // Per-build state: created here, carried on the service, drained by release.
          const subscriptions: AmqpSubscription[] = [];
          try {
            for (const queue of opts.queues) {
              subscriptions.push(
                await opts.driver.consume(queue, (delivery) =>
                  deliver(router, delivery, opts.idempotency),
                ),
              );
            }
          } catch (cause) {
            // Partial acquire: the build will fail, so no release is ever registered — cancel
            // the subscriptions that DID open before surfacing the error (best-effort).
            for (const subscription of subscriptions) {
              try {
                await subscription.cancel();
              } catch {
                // best-effort teardown of a failed acquire
              }
            }
            throw cause;
          }
          return { queues: opts.queues, subscriptions };
        })(),
        (cause) => new ConsumeError({ cause }),
      ),
    async ({ subscriptions }) => {
      for (const subscription of subscriptions) await subscription.cancel();
    },
  );
