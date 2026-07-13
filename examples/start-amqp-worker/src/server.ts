// Entry point — connect to the broker (the URL is a deployment endpoint, read at process
// bootstrap), assemble the graph with the real Payments adapter, and run the consume loop under
// `runHost`: it subscribes on build and, on SIGINT/SIGTERM, closes the scope (cancelling
// subscriptions) before the connection is closed. Startup failures are a static union.
import { runHost } from "@btravstack/start-kernel";
import { runConsumer } from "@btravstack/start-amqp";
import { Layer } from "demesne";

import { Logger } from "./application/ports.js";
import { bootstrap } from "./bootstrap.js";
import { CHARGE_QUEUE } from "./consumer.js";
import { createAmqpDriver } from "./infra/amqp-driver.js";
import { PaymentsLive } from "./infra/payments.js";
import { ConfigLive } from "./config.js";

const driver = await createAmqpDriver(process.env["AMQP_URL"] ?? "amqp://localhost");

const boot = Layer.provideTo(bootstrap(PaymentsLive), ConfigLive);
const graph = Layer.merge(
  boot,
  Layer.provideTo(runConsumer({ driver, queues: [CHARGE_QUEUE] }), boot),
);

const outcome = await runHost(graph, {
  onReady: (ctx) => ctx.get(Logger).info(`consuming ${CHARGE_QUEUE}`),
});

await driver.close();

outcome.match({
  ok: () => console.log("bye"),
  err: (error) => console.error(`consumer failed (${error._tag})`, error),
  defect: (cause) => console.error("panic:", cause),
});
