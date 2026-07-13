// Type-level tests (checked by `tsc`, no runtime). Prove the HTTP host's two guarantees at the
// mount: a route's disposition map is TOTAL over the handler's inferred domain error union, and a
// handler that reads a service outside `Parent | ReqP` is rejected (invariant B2).

import { defineContract, handler } from "@btravstack/start-kernel";
import { type Context, Layer, type Scope, Tag } from "demesne";
import { Err, Ok, TaggedError } from "unthrown";
import { z } from "zod";

import { api, createHttpApp } from "./index.js";

class AppSvc extends Tag("@test-d/AppSvc")<AppSvc, { readonly s: 1 }>() {}
class ReqSvc extends Tag("@test-d/ReqSvc")<ReqSvc, { readonly r: 1 }>() {}
class Foreign extends Tag("@test-d/Foreign")<Foreign, { readonly f: 1 }>() {}

class E1 extends TaggedError("@test-d/E1", { name: "E1" })<{ a: 1 }> {}

declare const reqLayer: Layer<ReqSvc, never, AppSvc | Scope>;
const c = defineContract({ input: z.object({}), output: z.object({ n: z.number() }) });

const app = createHttpApp<AppSvc>()(reqLayer);

// 1. In-scope handler (reads AppSvc + ReqSvc) with a TOTAL map over E1 — accepted.
app.route({
  method: "GET",
  path: "/ok",
  handler: handler(c, (_input, ctx: Context<AppSvc | ReqSvc>) => {
    void ctx.get(AppSvc);
    void ctx.get(ReqSvc);
    return Err(new E1({ a: 1 }));
  }),
  errors: { "@test-d/E1": () => api.error(500) },
});

// 2. Same handler, but the disposition map omits the "@test-d/E1" arm — not total over E.
app.route({
  method: "GET",
  path: "/missing-arm",
  handler: handler(c, (_input, ctx: Context<AppSvc>) => {
    void ctx.get(AppSvc);
    return Err(new E1({ a: 1 }));
  }),
  // @ts-expect-error - disposition map is not total over the handler's error union (E1).
  errors: {},
});

// 3. Handler reads `Foreign`, which is neither in the parent (AppSvc) nor the request layer
//    (ReqSvc) — B2 rejects it at the mount.
app.route({
  method: "GET",
  path: "/foreign",
  // @ts-expect-error - `Foreign` is not in `AppSvc | ReqSvc`, so the route must reject the handler.
  handler: handler(c, (_input, ctx: Context<Foreign>) => {
    void ctx.get(Foreign);
    return Ok({ n: 1 });
  }),
  errors: {},
});
