// Seam test: assemble the graph with a fake Payments (scripted failures), then drive the built
// `MessageRouter` directly — no broker. Proves the app graph + disposition triage: a valid charge
// acks, a transient failure requeues, a permanent one dead-letters, and a malformed message is
// dead-lettered as a poison message.
import { Layer, type ServiceOf } from "demesne";
import { Err, Ok } from "unthrown";
import { describe, expect, it } from "vitest";

import { Payments } from "./application/ports.js";
import { bootstrap } from "./bootstrap.js";
import { ConfigLive } from "./config.js";
import { CHARGE_QUEUE, MessageRouter } from "./consumer.js";
import { PaymentDeclined, PaymentUnavailable } from "./domain.js";

const buildRouter = async (
  charge: ServiceOf<Payments>["charge"],
): Promise<ServiceOf<MessageRouter>> => {
  const paymentsFake = Layer.value(Payments, { charge });
  const built = await Layer.build(Layer.provideTo(bootstrap(paymentsFake), ConfigLive));
  return built.match({
    ok: (ctx) => ctx.get(MessageRouter),
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

describe("charge worker", () => {
  it("acks a valid charge", async () => {
    const router = await buildRouter(() => Ok({ receiptId: "r1" }).toAsync());
    expect(await router.dispatch(CHARGE_QUEUE, { orderId: "o1", amount: 100 })).toEqual({
      kind: "ack",
    });
  });

  it("requeues a transient PaymentUnavailable", async () => {
    const router = await buildRouter(() =>
      Err(new PaymentUnavailable({ cause: "gateway down" })).toAsync(),
    );
    expect(await router.dispatch(CHARGE_QUEUE, { orderId: "o1", amount: 100 })).toEqual({
      kind: "requeue",
    });
  });

  it("dead-letters a permanent PaymentDeclined with its reason", async () => {
    const router = await buildRouter(() =>
      Err(new PaymentDeclined({ reason: "card declined" })).toAsync(),
    );
    expect(await router.dispatch(CHARGE_QUEUE, { orderId: "o1", amount: 100 })).toEqual({
      kind: "deadLetter",
      reason: "card declined",
    });
  });

  it("dead-letters a malformed message (negative amount) as poison", async () => {
    const router = await buildRouter(() => Ok({ receiptId: "r1" }).toAsync());
    expect(await router.dispatch(CHARGE_QUEUE, { orderId: "o1", amount: -5 })).toMatchObject({
      kind: "deadLetter",
    });
  });
});
