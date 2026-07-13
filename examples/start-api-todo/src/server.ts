// Entry point — build and run the graph with `runHost`: it connects the listener (an
// `acquireRelease` resource), runs `onReady`, then blocks until SIGINT/SIGTERM, at which point the
// scope closes and the listener shuts down (LIFO). Every startup failure is a static union
// (`ConfigError | ListenError`) handled once, below.
import { runHost } from "@btravstack/start-kernel";

import { AppLayer } from "./app.js";
import { Logger } from "./application/ports.js";

const outcome = await runHost(AppLayer, {
  onReady: (ctx) => ctx.get(Logger).info("todos api ready"),
});

outcome.match({
  ok: () => console.log("bye"),
  err: (error) => console.error(`startup failed (${error._tag})`, error),
  defect: (cause) => console.error("panic:", cause),
});
