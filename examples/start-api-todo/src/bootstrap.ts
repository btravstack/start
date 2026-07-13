// Bootstrap — the single place the application is assembled, generic over the repository so the
// volatile adapter stays a parameter (the demesne test seam): the server passes the in-memory
// repo, a test could pass a fake. The use cases read Logger + TodoRepository; the HTTP app reads
// the wired use cases. Composed by hand with `merge` / `provideTo` — no auto-wiring.
import { Layer } from "demesne";

import { TodoRepository } from "./application/ports.js";
import { CreateTodoLive, GetTodoLive, ListTodosLive } from "./application/use-cases.js";
import { HttpAppLive } from "./http/routes.js";
import { LoggerLive } from "./infra/adapters.js";

export const bootstrap = <R extends Layer<TodoRepository, unknown, unknown>>(repository: R) => {
  const useCases = Layer.merge(CreateTodoLive, GetTodoLive, ListTodosLive);
  const useCasesWired = Layer.provideTo(useCases, Layer.merge(LoggerLive, repository));
  const httpWired = Layer.provideTo(HttpAppLive, useCasesWired);
  // Expose everything; shared layers (LoggerLive, the repository, the wired use cases) build once
  // by reference. `Config` remains the only requirement, discharged in `app.ts`.
  return Layer.merge(LoggerLive, repository, useCasesWired, httpWired);
};
