// HTTP edge — an oRPC router served by a Hono app that IS start-api's `HttpApp` service (so
// start-api's `httpListener` serves it). `Layer.inject` builds it from the use cases; the injected
// `ctx` is the fork parent for the per-request scope. Each procedure is a `handlerResult`
// (`@unthrown/orpc`): the handler speaks `Result`, an `Ok` becomes the output, and an `Err` mapped
// to a declared `errors.CODE()` is typed END-TO-END (the client sees the exact code union). The
// domain→transport triage lives in one `mapErr` per procedure — the oRPC-native form of the
// disposition map.
import { HttpApp } from "@btravstack/start-api";
import { type Context as DemesneContext, Layer, type ServiceOf } from "demesne";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { handlerResult } from "@unthrown/orpc/server";
import { Hono } from "hono";
import { fromPromise, TaggedError } from "unthrown";
import { z } from "zod";

import { Logger } from "../application/ports.js";
import { CreateTodo, GetTodo, ListTodos } from "../application/use-cases.js";
import { RequestId, RequestScopeLive } from "./request.js";

type RequestScope = DemesneContext<RequestId>;

const base = os.$context<{ readonly scope: RequestScope }>();

type RouterDeps = {
  readonly list: ServiceOf<ListTodos>;
  readonly get: GetTodo;
  readonly create: ServiceOf<CreateTodo>;
};

// Module-scope so the router TYPE is exported for the typed client (`RouterClient<TodoRouter>`).
const makeRouter = ({ list, get, create }: RouterDeps) => ({
  todos: {
    list: base
      .errors({ STORAGE_FAILED: {} })
      .handler(handlerResult(({ errors }) => list().mapErr(() => errors.STORAGE_FAILED()))),
    get: base
      .input(z.object({ id: z.string() }))
      .errors({ NOT_FOUND: { message: "todo not found" }, STORAGE_FAILED: {} })
      .handler(
        handlerResult(({ input, errors }) =>
          get
            .execute(input.id)
            .mapErr((error) =>
              error._tag === "@app/TodoNotFound" ? errors.NOT_FOUND() : errors.STORAGE_FAILED(),
            ),
        ),
      ),
    create: base
      .input(z.object({ title: z.string().min(1).max(200) }))
      .errors({ STORAGE_FAILED: {} })
      .handler(
        handlerResult(({ input, errors }) => create(input).mapErr(() => errors.STORAGE_FAILED())),
      ),
  },
});

export type TodoRouter = ReturnType<typeof makeRouter>;

class RequestFailed extends TaggedError("@app/RequestFailed", { name: "RequestFailed" })<{
  readonly cause: unknown;
}> {}

export const HttpAppLive = Layer.inject(
  HttpApp,
  { list: ListTodos, get: GetTodo, create: CreateTodo, logger: Logger },
  ({ list, get, create, logger }, ctx) => {
    const rpc = new RPCHandler(makeRouter({ list, get, create }));
    const app = new Hono();

    // Per-request scope: fork off the app context, dispatch to the oRPC handler with the forked
    // context, stamp the request id, close the fork afterwards.
    app.all("*", async (c) => {
      const out = await Layer.forkScope(ctx, RequestScopeLive, (reqCtx) =>
        fromPromise(
          rpc.handle(c.req.raw, { prefix: "/rpc", context: { scope: reqCtx } }),
          (cause) => new RequestFailed({ cause }),
        ).map(({ response }): Response => {
          const res = response ?? c.json({ error: "no such procedure" }, 404);
          res.headers.set("x-request-id", reqCtx.get(RequestId).id);
          return res;
        }),
      );
      return out.match<Response>({
        ok: (response) => response,
        err: (error) => {
          logger.info(`request failed: ${String(error.cause)}`);
          return c.json({ error: "internal error" }, 500);
        },
        defect: () => c.json({ error: "internal error" }, 500),
      });
    });

    return app;
  },
);
