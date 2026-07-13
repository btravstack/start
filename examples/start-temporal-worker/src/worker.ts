// Entry point — build the graph (with the real Payments adapter), adapt the activity registry into
// Temporal ApplicationFailure-throwing functions, and run a Temporal Worker. The Worker owns the
// poll loop (Temporal's durability), so lifecycle is `worker.run()` rather than `runHost`. The
// graph has no `Scope` (no resources), so a plain `Layer.build` suffices.
import { ActivityRegistry } from "@btravstack/start-temporal";
import { Worker } from "@temporalio/worker";
import { Layer } from "demesne";

import { bootstrap } from "./bootstrap.js";
import { ConfigLive } from "./config.js";
import { toApplicationFailures } from "./infra/temporal.js";
import { PaymentsLive } from "./infra/payments.js";
import { workflowsPath } from "./workflows-path.js";

const built = await Layer.build(Layer.provideTo(bootstrap(PaymentsLive), ConfigLive));

const registry = built.match({
  ok: (ctx) => ctx.get(ActivityRegistry),
  err: (error) => {
    throw new Error(`config error: ${error._tag}`);
  },
  defect: (cause) => {
    throw cause;
  },
});

const worker = await Worker.create({
  taskQueue: "orders",
  activities: toApplicationFailures(registry.activities),
  workflowsPath: workflowsPath(import.meta.url),
});

await worker.run();
