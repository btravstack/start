// Bootstrap — assemble the graph, generic over the Payments adapter (the swappable seam). Exposes
// the Logger and the ActivityRegistry (the record of activity functions a worker registers).
import { Layer } from "demesne";

import { ActivitiesLive } from "./activities.js";
import { Payments } from "./application/ports.js";
import { ChargeOrderLive } from "./application/use-cases.js";
import { LoggerLive } from "./infra/logger.js";

export const bootstrap = <R extends Layer<Payments, unknown, unknown>>(payments: R) => {
  const chargeWired = Layer.provideTo(ChargeOrderLive, Layer.merge(LoggerLive, payments));
  const activitiesWired = Layer.provideTo(ActivitiesLive, chargeWired);
  return Layer.merge(LoggerLive, activitiesWired);
};
