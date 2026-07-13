// Type-level test suite (checked by `tsc` via tsconfig.test-d.json — no runtime). Proves the
// kernel's type guarantees: config infers its shape from the schema, and `runHost` accepts a
// scope-carrying graph while rejecting one with an unmet service (invariant K3).

import { type Context, Layer, type Scope, Tag } from "demesne";
import { type AsyncResult, Ok, TaggedError } from "unthrown";
import { z } from "zod";

import {
  type ConfigModule,
  type Contract,
  ContractError,
  defineConfig,
  defineContract,
  type DispositionMap,
  handler,
  runHandler,
  runHost,
} from "./index.js";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// --- 1. defineConfig infers the parsed shape from the zod schema -------------

const schema = z.object({
  PORT: z.coerce.number(),
  NAME: z.string(),
});
type Parsed = { PORT: number; NAME: string };

const configModule = defineConfig(schema);
// Equality with ConfigModule<Parsed> pins the schema-driven inference of the whole module
// (both the Config tag's service shape and the ConfigLive layer's channels).
type _module = Expect<Equal<typeof configModule, ConfigModule<Parsed>>>;

// A custom id flows into the module type (distinct runtime key for a second config in one graph).
const customConfig = defineConfig(schema, { id: "@test-d/CustomConfig" });
type _custom = Expect<Equal<typeof customConfig, ConfigModule<Parsed, "@test-d/CustomConfig">>>;

// --- 2. runHost accepts a Scope graph and rejects an unmet service (K3) ------

declare const scopeGraph: Layer<{ readonly a: 1 }, never, Scope>;
const ran = runHost(scopeGraph);
type _ran = Expect<Equal<typeof ran, AsyncResult<void, never>>>;

class Missing extends Tag("@btravstack/start/test-d/Missing")<Missing, { readonly m: 1 }>() {}
declare const unmet: Layer<{ readonly a: 1 }, never, Missing | Scope>;

// @ts-expect-error - the graph still needs `Missing`, so runHost must reject it (Needs = Scope only).
runHost(unmet);

// A custom `use` widens the result's value and error channels.
declare const scopeGraph2: Layer<{ readonly a: 1 }, "buildErr", Scope>;
const ranUse = runHost(scopeGraph2, {
  use: (): AsyncResult<number, "useErr"> => 0 as unknown as AsyncResult<number, "useErr">,
});
type _ranUse = Expect<Equal<typeof ranUse, AsyncResult<number, "buildErr" | "useErr">>>;

// Without a `use` there is no `A` type parameter to instantiate — claiming a value you won't
// produce is a compile error (the two overloads take 2 and 4 type arguments, never 3).
// @ts-expect-error - three explicit type arguments match neither runHost overload.
runHost<{ readonly a: 1 }, never, number>(scopeGraph);

// --- 3. defineContract infers In/Out from the schemas (no error set on the contract) ---

const c = defineContract({
  input: z.object({ id: z.string() }),
  output: z.object({ n: z.number() }),
});
type _contract = Expect<Equal<typeof c, Contract<{ id: string }, { n: number }>>>;

// --- 4. DispositionMap is TOTAL over the domain error union (missing arm = compile error) ---

class E1 extends TaggedError("@test-d/E1", { name: "E1" })<{ a: 1 }> {}
class E2 extends TaggedError("@test-d/E2", { name: "E2" })<{ b: 2 }> {}

const total: DispositionMap<E1 | E2, string> = {
  "@test-d/E1": () => "one",
  "@test-d/E2": () => "two",
};
void total;

// @ts-expect-error - missing the "@test-d/E2" arm: the map is not total over E1 | E2.
const partial: DispositionMap<E1 | E2, string> = {
  "@test-d/E1": () => "one",
};
void partial;

// --- 5. runHandler enforces B2: a handler needing a non-parent/non-request service is rejected ---

class AppSvc extends Tag("@test-d/AppSvc")<AppSvc, { readonly s: 1 }>() {}
class ReqSvc extends Tag("@test-d/ReqSvc")<ReqSvc, { readonly r: 1 }>() {}
class Foreign extends Tag("@test-d/Foreign")<Foreign, { readonly f: 1 }>() {}

declare const parent: Context<AppSvc>;
declare const reqLayer: Layer<ReqSvc, never, AppSvc | Scope>;

// A handler that reads only in-scope services (AppSvc from parent, ReqSvc from the fork) is fine.
const okBound = handler(c, (_input, ctx: Context<AppSvc | ReqSvc>) => {
  void ctx.get(AppSvc);
  void ctx.get(ReqSvc);
  return Ok({ n: 1 });
});
const okRun = runHandler(parent, reqLayer, okBound, {});
type _okRun = Expect<Equal<typeof okRun, AsyncResult<{ n: number }, ContractError>>>;

// A handler that reads a service neither the parent nor the request layer provides is rejected.
const foreignBound = handler(c, (_input, ctx: Context<Foreign>) => {
  void ctx.get(Foreign);
  return Ok({ n: 1 });
});
// @ts-expect-error - `Foreign` is not in `AppSvc | ReqSvc`, so runHandler must reject the handler (B2).
runHandler(parent, reqLayer, foreignBound, {});
