// Bootstrap — the single assembly point, generic over the repository (the swappable seam): the
// server passes the Prisma-backed repo, a test passes an in-memory fake. The use cases read
// Logger + TodoRepository; the oRPC app reads the wired use cases. Composed by hand.
import { Layer } from "demesne";

import { TodoRepository } from "./application/ports.js";
import { CreateTodoLive, GetTodoLive, ListTodosLive } from "./application/use-cases.js";
import { HttpAppLive } from "./http/router.js";
import { LoggerLive } from "./infra/logger.js";

export const bootstrap = <R extends Layer<TodoRepository, unknown, unknown>>(repository: R) => {
  const useCases = Layer.merge(CreateTodoLive, GetTodoLive, ListTodosLive);
  const useCasesWired = Layer.provideTo(useCases, Layer.merge(LoggerLive, repository));
  const httpWired = Layer.provideTo(HttpAppLive, Layer.merge(useCasesWired, LoggerLive));
  return Layer.merge(LoggerLive, repository, useCasesWired, httpWired);
};
