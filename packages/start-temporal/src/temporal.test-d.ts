// Type-level tests (checked by `tsc`, no runtime). Same two guarantees as the other hosts, at the
// activity() mount: the disposition map is TOTAL over the handler's inferred error union, and a
// handler reading a service outside `Parent | ReqP` is rejected (invariant B2).

import { defineContract, handler } from "@btravstack/start-kernel";
import { type Context, Layer, type Scope, Tag } from "demesne";
import { Err, Ok, TaggedError } from "unthrown";
import { z } from "zod";

import { createActivities, temporal } from "./index.js";

class AppSvc extends Tag("@test-d/AppSvc")<AppSvc, { readonly s: 1 }>() {}
class ReqSvc extends Tag("@test-d/ReqSvc")<ReqSvc, { readonly r: 1 }>() {}
class Foreign extends Tag("@test-d/Foreign")<Foreign, { readonly f: 1 }>() {}

class E1 extends TaggedError("@test-d/E1", { name: "E1" })<{ a: 1 }> {}

declare const reqLayer: Layer<ReqSvc, never, AppSvc | Scope>;
const c = defineContract({ input: z.object({}), output: z.object({ n: z.number() }) });

const activities = createActivities<AppSvc>()(reqLayer);

// 1. In-scope handler + TOTAL map over E1 — accepted.
activities.activity({
  name: "ok",
  handler: handler(c, (_input, ctx: Context<AppSvc | ReqSvc>) => {
    void ctx.get(AppSvc);
    void ctx.get(ReqSvc);
    return Err(new E1({ a: 1 }));
  }),
  errors: { "@test-d/E1": () => temporal.retryable() },
});

// 2. Disposition map omits the E1 arm — not total over the handler's error union.
activities.activity({
  name: "missing-arm",
  handler: handler(c, (_input, ctx: Context<AppSvc>) => {
    void ctx.get(AppSvc);
    return Err(new E1({ a: 1 }));
  }),
  // @ts-expect-error - disposition map is not total over E1.
  errors: {},
});

// 3. Handler reads `Foreign`, not in `AppSvc | ReqSvc` — B2 rejects it at the mount.
activities.activity({
  name: "foreign",
  // @ts-expect-error - `Foreign` is not in `AppSvc | ReqSvc`.
  handler: handler(c, (_input, ctx: Context<Foreign>) => {
    void ctx.get(Foreign);
    return Ok({ n: 1 });
  }),
  errors: {},
});
