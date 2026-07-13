// Bootstrap — assemble the graph, generic over the Payments adapter (the swappable seam): the
// server passes the real adapter, a test passes a fake with scripted failures. Composed by hand.
import { Layer } from "demesne";

import { Payments } from "./application/ports.js";
import { ChargeOrderLive } from "./application/use-cases.js";
import { ConsumerLive } from "./consumer.js";
import { LoggerLive } from "./infra/logger.js";

export const bootstrap = <R extends Layer<Payments, unknown, unknown>>(payments: R) => {
  const chargeWired = Layer.provideTo(ChargeOrderLive, Layer.merge(LoggerLive, payments));
  const routerWired = Layer.provideTo(ConsumerLive, chargeWired);
  // Expose Logger (for the ready line) and the MessageRouter (what `runConsumer` consumes).
  return Layer.merge(LoggerLive, routerWired);
};
