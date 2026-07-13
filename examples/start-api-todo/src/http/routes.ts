// HTTP edge — contracts (zod I/O only, no error set) bound to the use cases with `handler.use`,
// and mounted on `createHttpApp`. The domain→HTTP translation lives entirely in each route's
// disposition map (invariant B1): `TodoNotFound` → 404, `RepositoryError` → 500. The Hono app is
// itself a demesne service, the fork parent for a per-request `RequestId` scope.
import { api, createHttpApp } from "@btravstack/start-api";
import { defineContract, handler } from "@btravstack/start-kernel";
import { Layer, Tag } from "demesne";
import { z } from "zod";

import { CreateTodo, GetTodo, ListTodos } from "../application/use-cases.js";

const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
});

const CreateTodoContract = defineContract({
  input: z.object({ title: z.string().min(1).max(200) }),
  output: TodoSchema,
});
const GetTodoContract = defineContract({
  input: z.object({ id: z.string() }),
  output: TodoSchema,
});
const ListTodosContract = defineContract({
  input: z.object({}),
  output: z.array(TodoSchema),
});

// Per-request scope: a fresh id for every request (a request-tagged logger would live here too).
export class RequestId extends Tag("@app/RequestId")<RequestId, { readonly id: string }>() {}
const RequestScopeLive = Layer.factory(RequestId, () => ({ id: crypto.randomUUID() }));

// The parent context the routes read from — exactly the use cases the handlers dispatch to.
type AppServices = CreateTodo | GetTodo | ListTodos;

export const HttpAppLive = createHttpApp<AppServices>()(RequestScopeLive)
  .route({
    method: "POST",
    path: "/todos",
    handler: handler.use(CreateTodoContract, CreateTodo, (create, input) => create(input)),
    errors: { "@app/RepositoryError": () => api.error(500) },
  })
  .route({
    method: "GET",
    path: "/todos",
    handler: handler.use(ListTodosContract, ListTodos, (list) => list()),
    errors: { "@app/RepositoryError": () => api.error(500) },
  })
  .route({
    method: "GET",
    path: "/todos/:id",
    handler: handler.use(GetTodoContract, GetTodo, (get, input) => get.execute(input.id)),
    errors: {
      "@app/TodoNotFound": () => api.error(404, { error: "todo not found" }),
      "@app/RepositoryError": () => api.error(500),
    },
  })
  .build();
