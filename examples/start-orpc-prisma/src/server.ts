// Entry point — run the assembled graph with `runHost`: building it connects Prisma and starts the
// listener (both resources), then it blocks until SIGINT/SIGTERM, closing the scope (listener
// stops, Prisma disconnects) LIFO. Every startup failure is a static union handled once.
import { runHost } from "@btravstack/start-kernel";

import { AppLayer } from "./app.js";
import { Logger } from "./application/ports.js";

const outcome = await runHost(AppLayer, {
  onReady: (ctx) => ctx.get(Logger).info("todos oRPC api ready"),
});

outcome.match({
  ok: () => console.log("bye"),
  err: (error) => console.error(`startup failed (${error._tag})`, error),
  defect: (cause) => console.error("panic:", cause),
});
