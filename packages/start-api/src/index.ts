// @btravstack/start-api — the HTTP host for btravstack start. Serve demesne-wired contracts over
// Hono, one request per fork scope, with domain errors mapped by a total disposition map. It is
// pure transport glue over @btravstack/start-kernel:
//   • createHttpApp — a builder that turns (contract + handler + disposition map) routes into a
//     Hono app, itself a demesne service (the fork parent for each request scope)
//   • httpListener  — the Node listener as an `acquireRelease` resource, torn down on shutdown
//   • api.error     — build an HTTP disposition for a domain error
//
// End-to-end typed clients (oRPC) can layer on top of this later; the host seam itself is here.

export {
  type ApiMethod,
  createHttpApp,
  HttpApp,
  type HttpAppBuilder,
  type RouteSpec,
} from "./app.js";
export { api, type ApiDisposition } from "./disposition.js";
export { HttpServer, httpListener, ListenConfig, ListenError } from "./listener.js";
