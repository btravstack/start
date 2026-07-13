import "@unthrown/vitest";

import { type Context, Layer, Tag } from "demesne";
import { type AsyncResult, Err, Ok, TaggedError } from "unthrown";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineContract } from "./contract.js";
import { type DispositionMap, dispatch, handler, runHandler } from "./handler.js";

// --- a tiny app graph: a Repo port, a CreateTodo use case, a request-scoped RequestId ----------

type Todo = { readonly id: string; readonly title: string };

class RepoError extends TaggedError("@test/RepoError", { name: "RepoError" })<{
  readonly cause: string;
}> {}

class Repo extends Tag("@test/Repo")<
  Repo,
  { readonly create: (title: string) => AsyncResult<Todo, RepoError> }
>() {}

class CreateTodo extends Tag("@test/CreateTodo")<
  CreateTodo,
  (title: string) => AsyncResult<Todo, RepoError>
>() {}

const CreateTodoLive = Layer.inject(CreateTodo, { repo: Repo }, ({ repo }) => repo.create);

class RequestId extends Tag("@test/RequestId")<RequestId, { readonly id: string }>() {}
const RequestIdLive = Layer.factory(RequestId, () => ({ id: "req-1" }));

const contract = defineContract({
  input: z.object({ title: z.string().min(1) }),
  output: z.object({ id: z.string(), title: z.string() }),
});

// Build the parent (app) context, parametrized on how the repo behaves.
const buildParent = async (
  create: (title: string) => AsyncResult<Todo, RepoError>,
): Promise<Context<Repo | CreateTodo>> => {
  const RepoLive = Layer.value(Repo, { create });
  const app = Layer.merge(RepoLive, Layer.provideTo(CreateTodoLive, RepoLive));
  const built = await Layer.build(app);
  return built.match({
    ok: (ctx) => ctx,
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

describe("runHandler + handler.use", () => {
  it("validates, forks a request scope, dispatches to the use case, and returns the output", async () => {
    const parent = await buildParent((title) => Ok({ id: "t1", title }).toAsync());
    const bound = handler.use(contract, CreateTodo, (create, input) => create(input.title));

    await expect(runHandler(parent, RequestIdLive, bound, { title: "buy milk" })).toBeOkWith({
      id: "t1",
      title: "buy milk",
    });
  });

  it("surfaces invalid input as a ContractError, before the handler runs OR the fork opens", async () => {
    let ran = false;
    let forksBuilt = 0;
    const parent = await buildParent((title) => {
      ran = true;
      return Ok({ id: "t1", title }).toAsync();
    });
    const countingRequestLayer = Layer.factory(RequestId, () => {
      forksBuilt += 1;
      return { id: "req-counted" };
    });
    const bound = handler.use(contract, CreateTodo, (create, input) => create(input.title));

    await expect(runHandler(parent, countingRequestLayer, bound, { title: "" })).toBeErrWith(
      expect.objectContaining({ _tag: "@btravstack/start/ContractError" }),
    );
    expect(ran).toBe(false);
    // Invalid input must not open a request scope — no request-scoped service was built.
    expect(forksBuilt).toBe(0);
  });

  it("enforces the output schema: unknown keys are STRIPPED (no over-exposure past the contract)", async () => {
    // A rich domain row with a column the contract never promised.
    const row = { id: "t1", title: "buy milk", secretColumn: "do-not-leak" };
    const parent = await buildParent(() => Ok(row).toAsync());
    const bound = handler.use(contract, CreateTodo, (create, input) => create(input.title));

    await expect(runHandler(parent, RequestIdLive, bound, { title: "buy milk" })).toBeOkWith({
      id: "t1",
      title: "buy milk",
    });
  });

  it("treats a non-conforming output as a Defect (a programming error, not a domain failure)", async () => {
    const broken = { nope: true } as unknown as Todo;
    const parent = await buildParent(() => Ok(broken).toAsync());
    const bound = handler.use(contract, CreateTodo, (create, input) => create(input.title));

    const result = await runHandler(parent, RequestIdLive, bound, { title: "x" });

    const outcome = result.match({
      ok: () => "ok",
      err: () => "err",
      defect: (cause) => `defect:${String(cause)}`,
    });
    expect(outcome).toContain("defect:");
    expect(outcome).toContain("does not match the contract");
  });

  it("returns the domain error untranslated, for the mount's disposition map to translate", async () => {
    const parent = await buildParent(() => Err(new RepoError({ cause: "db down" })).toAsync());
    const bound = handler.use(contract, CreateTodo, (create, input) => create(input.title));

    const result = await runHandler(parent, RequestIdLive, bound, { title: "x" });

    // The host owns the translation (invariant B1) — here a fake status disposition.
    const map: DispositionMap<RepoError, string> = {
      "@test/RepoError": (error) => `500:${error.cause}`,
    };
    const disposition = result.match({
      ok: () => "ok",
      err: (error) =>
        error._tag === "@btravstack/start/ContractError" ? "400" : dispatch(map, error),
      defect: () => "defect",
    });

    expect(disposition).toBe("500:db down");
  });
});

describe("handler (primitive) reads request-scoped services off the fork context", () => {
  it("can read the forked RequestId alongside the app use case", async () => {
    const parent = await buildParent((title) => Ok({ id: "t2", title }).toAsync());
    // The primitive `handler` declares its requirements by annotating `ctx` (invariant #2 —
    // requirements are declared at the boundary, never inferred from the `ctx.get` calls).
    const bound = handler(contract, (input, ctx: Context<CreateTodo | RequestId>) =>
      ctx.get(CreateTodo)(`${input.title} [${ctx.get(RequestId).id}]`),
    );

    await expect(runHandler(parent, RequestIdLive, bound, { title: "walk" })).toBeOkWith({
      id: "t2",
      title: "walk [req-1]",
    });
  });
});
