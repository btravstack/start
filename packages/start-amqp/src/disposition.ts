// The AMQP host's disposition type `D` (the concrete `D` in the kernel's `DispositionMap<E, D>`):
// what to do with a message after handling it. Unlike HTTP (req→res), the error surface here is
// the broker's settlement — ack / requeue / dead-letter — so a domain error is translated to a
// settlement decision at the mount, never inside a handler (invariant B1). The distinctive AMQP
// concern is that a *transient* failure should requeue (retry) while a *permanent* one should
// dead-letter, and the disposition map is exactly where that call is made per error.

export type AmqpDisposition =
  | { readonly kind: "ack" }
  | { readonly kind: "requeue" }
  | { readonly kind: "deadLetter"; readonly reason: string };

export const amqp = {
  /** Settle the message as handled. */
  ack: (): AmqpDisposition => ({ kind: "ack" }),
  /** Nack + requeue — a transient failure that a retry may resolve. */
  requeue: (): AmqpDisposition => ({ kind: "requeue" }),
  /** Nack without requeue — a permanent failure; route to the dead-letter queue. */
  deadLetter: (reason = "rejected"): AmqpDisposition => ({ kind: "deadLetter", reason }),
} as const;
