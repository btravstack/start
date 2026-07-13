// The Temporal host's disposition type `D` (the concrete `D` in the kernel's `DispositionMap<E,
// D>`): whether a failed activity should be RETRIED by Temporal's runtime, or fail permanently.
// Durability inverts control — retries, timeouts, and backoff are the runtime's job, configured on
// the activity, not coded in the handler — so a domain error is translated to a *retryability*
// decision at the mount (invariant B1), never inside the handler.

export type TemporalDisposition =
  | { readonly kind: "retryable" }
  | { readonly kind: "nonRetryable"; readonly reason: string };

export const temporal = {
  /** Let Temporal's retry policy retry the activity (a transient failure). */
  retryable: (): TemporalDisposition => ({ kind: "retryable" }),
  /** Fail the activity permanently — Temporal will not retry (a business rejection). */
  nonRetryable: (reason = "rejected"): TemporalDisposition => ({ kind: "nonRetryable", reason }),
} as const;
