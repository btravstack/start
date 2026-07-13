import { defineContract, handler } from "@btravstack/start-kernel";
import { type Context, Layer, Tag } from "demesne";
import type { Hono } from "hono";
import { type AsyncResult, Err, Ok, TaggedError } from "unthrown";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createHttpApp, HttpApp } from "./app.js";
import { api } from "./disposition.js";

// --- a tiny app graph (parent): a Repo port + a CreateTodo use case ----------------------------

type Todo = { readonly id: string; readonly title: string };
const TodoSchema = z.object({ id: z.string(), title: z.string() });

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

const CreateTodoContract = defineContract({
  input: z.object({ title: z.string().min(1) }),
  output: TodoSchema,
});
const WhoAmIContract = defineContract({
  input: z.object({}),
  output: z.object({ id: z.string() }),
});

// Build the Hono app, parametrized on the repo's behavior.
const buildApp = async (create: (title: string) => AsyncResult<Todo, RepoError>): Promise<Hono> => {
  const repo = Layer.value(Repo, { create });
  const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));

  const httpApp = createHttpApp<Repo | CreateTodo>()(RequestIdLive)
    .route({
      method: "POST",
      path: "/todos",
      handler: handler.use(CreateTodoContract, CreateTodo, (fn, input) => fn(input.title)),
      errors: { "@test/RepoError": () => api.error(500, { error: "storage" }) },
    })
    .route({
      method: "GET",
      path: "/whoami",
      // primitive handler reading the request-scoped RequestId off the fork context
      handler: handler(WhoAmIContract, (_input, ctx: Context<RequestId>) =>
        Ok({ id: ctx.get(RequestId).id }),
      ),
      errors: {},
    })
    .build();

  const built = await Layer.build(Layer.provideTo(httpApp, parent));
  return built.match({
    ok: (ctx) => ctx.get(HttpApp),
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

describe("createHttpApp", () => {
  it("serves a contract: valid POST returns the handler output as JSON (200)", async () => {
    const app = await buildApp((title) => Ok({ id: "t1", title }).toAsync());

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "buy milk" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", title: "buy milk" });
  });

  it("rejects invalid input with 400 before the handler runs", async () => {
    let ran = false;
    const app = await buildApp((title) => {
      ran = true;
      return Ok({ id: "t1", title }).toAsync();
    });

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });

    expect(res.status).toBe(400);
    expect(ran).toBe(false);
  });

  it("maps a domain error through the route's disposition map (500)", async () => {
    const app = await buildApp(() => Err(new RepoError({ cause: "db down" })).toAsync());

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "storage" });
  });

  it("exposes request-scoped services to the handler via the fork (GET /whoami)", async () => {
    const app = await buildApp((title) => Ok({ id: "t2", title }).toAsync());

    const res = await app.request("/whoami");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "req-1" });
  });

  it("rejects an ARRAY JSON body with 400 (no spread into numeric keys)", async () => {
    const app = await buildApp((title) => Ok({ id: "t1", title }).toAsync());

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ title: "smuggled" }]),
    });

    expect(res.status).toBe(400);
  });

  it("returns the route's `success` status on Ok (201 for a create)", async () => {
    const repo = Layer.value(Repo, {
      create: (title: string) => Ok({ id: "t9", title }).toAsync(),
    });
    const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));
    const httpApp = createHttpApp<Repo | CreateTodo>()(RequestIdLive)
      .route({
        method: "POST",
        path: "/todos",
        handler: handler.use(CreateTodoContract, CreateTodo, (fn, input) => fn(input.title)),
        errors: { "@test/RepoError": () => api.error(500) },
        success: 201,
      })
      .build();
    const built = await Layer.build(Layer.provideTo(httpApp, parent));
    const app = built.match({
      ok: (ctx) => ctx.get(HttpApp),
      err: () => {
        throw new Error("unexpected build error");
      },
      defect: (cause) => {
        throw cause;
      },
    });

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "created" }),
    });

    expect(res.status).toBe(201);
  });

  it("maps a request-scope build failure (RErr — outside the disposition map) to 500", async () => {
    class ScopeDown extends TaggedError("@test/ScopeDown", { name: "ScopeDown" })<{
      readonly cause: string;
    }> {}
    const failingRequestLayer = Layer.make(RequestId, () =>
      Err(new ScopeDown({ cause: "redis down" })),
    );
    const repo = Layer.value(Repo, {
      create: (title: string) => Ok({ id: "t1", title }).toAsync(),
    });
    const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));
    const httpApp = createHttpApp<Repo | CreateTodo>()(failingRequestLayer)
      .route({
        method: "POST",
        path: "/todos",
        handler: handler.use(CreateTodoContract, CreateTodo, (fn, input) => fn(input.title)),
        errors: { "@test/RepoError": () => api.error(500, { error: "storage" }) },
      })
      .build();
    const built = await Layer.build(Layer.provideTo(httpApp, parent));
    const app = built.match({
      ok: (ctx) => ctx.get(HttpApp),
      err: () => {
        throw new Error("unexpected build error");
      },
      defect: (cause) => {
        throw cause;
      },
    });

    const res = await app.request("/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "valid" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
  });
});
