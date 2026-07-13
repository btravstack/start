import { defineContract, handler } from "@btravstack/start-kernel";
import { Layer, type ServiceOf, Tag } from "demesne";
import { type AsyncResult, Err, Ok, TaggedError } from "unthrown";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { amqp } from "./disposition.js";
import { createConsumer, MessageRouter } from "./router.js";

// --- fixtures: a Repo port + a CreateTodo use case (same shape as the other hosts) -------------

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

const buildRouter = async (
  create: (title: string) => AsyncResult<Todo, RepoError>,
): Promise<ServiceOf<MessageRouter>> => {
  const repo = Layer.value(Repo, { create });
  const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));

  const routerLayer = createConsumer<Repo | CreateTodo>()(RequestIdLive)
    .consume({
      queue: "todos.create",
      handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
      errors: {
        "@test/RepoError": (error) =>
          error.cause === "transient" ? amqp.requeue() : amqp.deadLetter("permanent"),
      },
    })
    .build();

  const built = await Layer.build(Layer.provideTo(routerLayer, parent));
  return built.match({
    ok: (ctx) => ctx.get(MessageRouter),
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

describe("MessageRouter dispatch triage", () => {
  it("acks a successfully handled message", async () => {
    const router = await buildRouter((title) => Ok({ id: "t1", title }).toAsync());
    expect(await router.dispatch("todos.create", { title: "buy milk" })).toEqual({ kind: "ack" });
  });

  it("dead-letters a malformed message (ContractError — permanent)", async () => {
    const router = await buildRouter((title) => Ok({ id: "t1", title }).toAsync());
    expect(await router.dispatch("todos.create", { title: "" })).toMatchObject({
      kind: "deadLetter",
    });
  });

  it("requeues a transient domain error via the disposition map", async () => {
    const router = await buildRouter(() => Err(new RepoError({ cause: "transient" })).toAsync());
    expect(await router.dispatch("todos.create", { title: "x" })).toEqual({ kind: "requeue" });
  });

  it("dead-letters a permanent domain error via the disposition map", async () => {
    const router = await buildRouter(() => Err(new RepoError({ cause: "fatal" })).toAsync());
    expect(await router.dispatch("todos.create", { title: "x" })).toEqual({
      kind: "deadLetter",
      reason: "permanent",
    });
  });

  it("dead-letters a message for a queue with no consumer", async () => {
    const router = await buildRouter((title) => Ok({ id: "t1", title }).toAsync());
    expect(await router.dispatch("unknown.queue", {})).toMatchObject({
      kind: "deadLetter",
      reason: expect.stringContaining("no consumer"),
    });
  });

  it("requeues when the request scope itself fails to build (RErr fallback — assume transient)", async () => {
    let ran = false;
    const repo = Layer.value(Repo, {
      create: (title: string) => {
        ran = true;
        return Ok({ id: "t1", title }).toAsync();
      },
    });
    const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));
    class ScopeDown extends TaggedError("@test/ScopeDown", { name: "ScopeDown" })<{
      readonly cause: string;
    }> {}
    const failingRequestLayer = Layer.make(RequestId, () =>
      Err(new ScopeDown({ cause: "redis down" })),
    );

    const routerLayer = createConsumer<Repo | CreateTodo>()(failingRequestLayer)
      .consume({
        queue: "todos.create",
        handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
        errors: { "@test/RepoError": () => amqp.deadLetter("unreachable") },
      })
      .build();
    const built = await Layer.build(Layer.provideTo(routerLayer, parent));
    const router = built.match({
      ok: (ctx) => ctx.get(MessageRouter),
      err: () => {
        throw new Error("unexpected build error");
      },
      defect: (cause) => {
        throw cause;
      },
    });

    expect(await router.dispatch("todos.create", { title: "x" })).toEqual({ kind: "requeue" });
    expect(ran).toBe(false);
  });

  it("warns in development when two consumers register the same queue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const repo = Layer.value(Repo, {
        create: (title: string) => Ok({ id: "t1", title }).toAsync(),
      });
      const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));
      const spec = {
        queue: "todos.create",
        handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
        errors: { "@test/RepoError": () => amqp.requeue() },
      } as const;
      const routerLayer = createConsumer<Repo | CreateTodo>()(RequestIdLive)
        .consume(spec)
        .consume(spec)
        .build();

      await Layer.build(Layer.provideTo(routerLayer, parent));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate consumer"));
    } finally {
      warn.mockRestore();
    }
  });

  it("the builder is immutable: branches off a shared base do not see each other's consumers", async () => {
    const repo = Layer.value(Repo, {
      create: (title: string) => Ok({ id: "t1", title }).toAsync(),
    });
    const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));
    const base = createConsumer<Repo | CreateTodo>()(RequestIdLive);
    const specFor = (queue: string) => ({
      queue,
      handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
      errors: { "@test/RepoError": () => amqp.requeue() },
    });

    const branchA = base.consume(specFor("queue.a")).build();
    const built = await Layer.build(Layer.provideTo(branchA, parent));
    const routerA = built.match({
      ok: (ctx) => ctx.get(MessageRouter),
      err: () => {
        throw new Error("unexpected build error");
      },
      defect: (cause) => {
        throw cause;
      },
    });
    // branch B was never consumed into branch A — and vice versa: base stayed pristine.
    void base.consume(specFor("queue.b"));

    expect(await routerA.dispatch("queue.b", { title: "x" })).toMatchObject({
      kind: "deadLetter",
      reason: expect.stringContaining("no consumer"),
    });
    expect(await routerA.dispatch("queue.a", { title: "x" })).toEqual({ kind: "ack" });
  });
});
