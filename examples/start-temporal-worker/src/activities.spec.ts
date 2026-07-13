// Seam tests: assemble the graph with a fake Payments, then invoke the activity functions
// directly — no Temporal cluster. Two layers are checked: start-temporal's activity dispatch
// (success returns output, failure throws with the retryable flag), and this example's real
// `toApplicationFailures` adapter (mapping to @temporalio's ApplicationFailure with `nonRetryable`).
import { ActivityRegistry } from "@btravstack/start-temporal";
import { ApplicationFailure } from "@temporalio/common";
import { Layer, type ServiceOf } from "demesne";
import { Err, Ok } from "unthrown";
import { describe, expect, it } from "vitest";

import { CHARGE_ACTIVITY } from "./activities.js";
import { Payments } from "./application/ports.js";
import { bootstrap } from "./bootstrap.js";
import { ConfigLive } from "./config.js";
import { PaymentDeclined, PaymentUnavailable } from "./domain.js";
import { toApplicationFailures } from "./infra/temporal.js";

const buildActivities = async (
  charge: ServiceOf<Payments>["charge"],
): Promise<ServiceOf<ActivityRegistry>["activities"]> => {
  const paymentsFake = Layer.value(Payments, { charge });
  const built = await Layer.build(Layer.provideTo(bootstrap(paymentsFake), ConfigLive));
  return built.match({
    ok: (ctx) => ctx.get(ActivityRegistry).activities,
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

const run = (
  activities: ServiceOf<ActivityRegistry>["activities"],
  name: string,
  input: unknown,
): Promise<unknown> => {
  const fn = activities[name];
  if (fn === undefined) throw new Error(`no activity ${name}`);
  return fn(input);
};

const caught = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
};

const CMD = { orderId: "o1", amount: 100 };

describe("charge activity", () => {
  it("returns the receipt on success", async () => {
    const activities = await buildActivities(() => Ok({ receiptId: "r1" }).toAsync());
    await expect(run(activities, CHARGE_ACTIVITY, CMD)).resolves.toEqual({ receiptId: "r1" });
  });

  it("throws a retryable failure for a transient PaymentUnavailable", async () => {
    const activities = await buildActivities(() =>
      Err(new PaymentUnavailable({ cause: "gateway down" })).toAsync(),
    );
    await expect(run(activities, CHARGE_ACTIVITY, CMD)).rejects.toMatchObject({ retryable: true });
  });

  it("throws a non-retryable failure for a permanent PaymentDeclined", async () => {
    const activities = await buildActivities(() =>
      Err(new PaymentDeclined({ reason: "card declined" })).toAsync(),
    );
    await expect(run(activities, CHARGE_ACTIVITY, CMD)).rejects.toMatchObject({
      retryable: false,
      reason: "card declined",
    });
  });
});

describe("toApplicationFailures — the Temporal error adapter", () => {
  it("maps a permanent failure to a non-retryable ApplicationFailure", async () => {
    const activities = toApplicationFailures(
      await buildActivities(() => Err(new PaymentDeclined({ reason: "card declined" })).toAsync()),
    );
    const error = await caught(run(activities, CHARGE_ACTIVITY, CMD));
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
  });

  it("maps a transient failure to a retryable ApplicationFailure", async () => {
    const activities = toApplicationFailures(
      await buildActivities(() => Err(new PaymentUnavailable({ cause: "down" })).toAsync()),
    );
    const error = await caught(run(activities, CHARGE_ACTIVITY, CMD));
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(false);
  });
});
