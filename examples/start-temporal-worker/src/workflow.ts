// A Temporal workflow — deterministic orchestration. This is the determinism guardrail in action:
// the workflow is handed ONLY typed activity proxies (via `proxyActivities`), never a demesne
// context, so I/O cannot reach it. It can't break determinism by injecting a service because it is
// never given one. (Temporal bundles this module in isolation.)
import { proxyActivities } from "@temporalio/workflow";

import type { ChargeCommand, Receipt } from "./domain.js";

const { chargeOrder } = proxyActivities<{
  chargeOrder: (command: ChargeCommand) => Promise<Receipt>;
}>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5 },
});

export const orderWorkflow = async (command: ChargeCommand): Promise<Receipt> =>
  chargeOrder(command);
