// @btravstack/start-temporal — the Temporal host for btravstack start. Run demesne-wired contracts
// as activities, one fork scope per activity, mapping domain errors to retryable / non-retryable
// (the runtime owns retries/timeouts). Pure transport glue over @btravstack/start-kernel:
//   • createActivities — a builder turning (contract + handler + disposition map) activities into
//     an ActivityRegistry service (a record of activity functions for a Temporal worker)
//   • temporal.retryable / nonRetryable — build a retryability disposition for a domain error
//   • TemporalActivityFailure — the boundary error an activity throws; a worker adapter maps it
//     to a (non-)retryable ApplicationFailure
//
// Determinism: demesne integrates on the ACTIVITY side (activities do I/O). Workflows stay
// deterministic by construction — they are handed activity proxies, never a demesne context — so
// no `Deterministic` marker is needed. The @temporalio worker/client is injected, not bundled.

export {
  type ActivitiesBuilder,
  ActivityRegistry,
  type ActivitySpec,
  createActivities,
  TemporalActivityFailure,
} from "./activity.js";
export { type TemporalDisposition, temporal } from "./disposition.js";
