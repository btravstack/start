// The HTTP listener as a demesne RESOURCE (generalizes the example's `HttpServerLive`): acquire
// starts the Node server and resolves once it is actually listening (PORT 0 works, reporting the
// real port); release closes it. Because it is an `acquireRelease`, the graph carries `Scope` — so
// it can only be run with `runHost` / `Layer.scoped`, and the listener can never leak past
// shutdown (it closes LIFO alongside the rest of the graph).

import { serve, type ServerType } from "@hono/node-server";
import { type Context, Layer, type Scope, Tag } from "demesne";
import { fromPromise, TaggedError } from "unthrown";

import { HttpApp } from "./app.js";

export class HttpServer extends Tag("@btravstack/start-api/HttpServer")<
  HttpServer,
  { readonly port: number; readonly server: ServerType }
>() {}

export class ListenError extends TaggedError("@btravstack/start-api/ListenError", {
  name: "ListenError",
})<{
  readonly cause: unknown;
}> {}

// The listener's configuration as a demesne service — the factor-III seam. The app maps its own
// validated config into this (`Layer.inject(ListenConfig, { config: Config }, ({ config }) => ({
// port: config.PORT }))`), or provides it statically (`Layer.value(ListenConfig, { port: 3000 })`).
// Config flowing through the graph as a service (rather than a closure over an app-specific tag)
// keeps the listener generic and its `Needs` exact.
export class ListenConfig extends Tag("@btravstack/start-api/ListenConfig")<
  ListenConfig,
  { readonly port: number }
>() {}

export const httpListener = (): Layer<HttpServer, ListenError, HttpApp | ListenConfig | Scope> =>
  Layer.acquireRelease(
    HttpServer,
    (ctx: Context<HttpApp | ListenConfig>) =>
      fromPromise(
        new Promise<{ readonly port: number; readonly server: ServerType }>((resolve, reject) => {
          const server = serve(
            { fetch: ctx.get(HttpApp).fetch, port: ctx.get(ListenConfig).port },
            (info) => {
              resolve({ port: info.port, server });
            },
          );
          server.once("error", reject); // e.g. EADDRINUSE → modeled ListenError
        }),
        (cause) => new ListenError({ cause }),
      ),
    ({ server }) =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Sever keep-alive sockets so shutdown isn't delayed until keepAliveTimeout.
        if ("closeAllConnections" in server) server.closeAllConnections();
      }),
  );
