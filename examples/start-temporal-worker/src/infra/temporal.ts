// The REAL Temporal integration seam: adapt the activity registry's functions (which throw
// start-temporal's `TemporalActivityFailure` carrying a `retryable` flag) into functions a Temporal
// worker understands — a success returns the value, a failure throws an `ApplicationFailure` with
// `nonRetryable` set from the disposition. This is the one place @temporalio's error model meets
// ours; the worker registers the result.
import { TemporalActivityFailure } from "@btravstack/start-temporal";
import { ApplicationFailure } from "@temporalio/common";

type ActivityFn = (input: unknown) => Promise<unknown>;

export const toApplicationFailures = (
  activities: Readonly<Record<string, ActivityFn>>,
): Record<string, ActivityFn> =>
  Object.fromEntries(
    Object.entries(activities).map(([name, run]) => [
      name,
      async (input: unknown): Promise<unknown> => {
        try {
          return await run(input);
        } catch (error) {
          if (error instanceof TemporalActivityFailure) {
            throw ApplicationFailure.create({
              message: error.reason,
              nonRetryable: !error.retryable,
            });
          }
          throw error;
        }
      },
    ]),
  );
