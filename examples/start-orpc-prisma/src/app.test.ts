// End-to-end test with NO database. It goes through the SAME `bootstrap` as the server, swapping
// only the repository for an in-memory fake (the port drops in without Prisma/Postgres). It drives
// the real app through a TYPED oRPC client whose fetch loops straight back into the Hono app — a
// genuine request/response cycle, JSON serialization and typed-error inference included, without a
// socket.
import { describe, expect, it } from "vitest";

// Registers the Result / AsyncResult matchers.
import "@unthrown/vitest";

import { HttpApp } from "@btravstack/start-api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createResultClient } from "@unthrown/orpc/client";
import { Layer, type ServiceOf } from "demesne";
import { Err, Ok } from "unthrown";

import { TodoRepository } from "./application/ports.js";
import { bootstrap } from "./bootstrap.js";
import { type Todo, TodoNotFound } from "./domain.js";
import type { TodoRouter } from "./http/router.js";

const makeFakeRepo = (): ServiceOf<TodoRepository> => {
  const store: Todo[] = [];
  return {
    list: () => Ok(store.slice() as readonly Todo[]).toAsync(),
    findById: (id) => {
      const found = store.find((todo) => todo.id === id);
      return (found !== undefined ? Ok(found) : Err(new TodoNotFound({ id }))).toAsync();
    },
    create: (input) => {
      const created: Todo = {
        id: `id-${store.length + 1}`,
        title: input.title,
        completed: false,
        createdAt: new Date("2020-06-01T00:00:00Z"),
      };
      store.push(created);
      return Ok(created).toAsync();
    },
  };
};

const buildApp = async (): Promise<ServiceOf<HttpApp>> => {
  const built = await Layer.build(bootstrap(Layer.value(TodoRepository, makeFakeRepo())));
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

const clientFor = (app: ServiceOf<HttpApp>) =>
  createResultClient(
    createORPCClient<RouterClient<TodoRouter>>(
      new RPCLink({
        url: "/rpc",
        fetch: async (url, init) => app.request(new Request(new URL(url, "http://app.test"), init)),
      }),
    ),
  );

describe("todos oRPC api (typed client over the app)", () => {
  it("creates then lists a todo", async () => {
    const rc = clientFor(await buildApp());

    await expect(rc.todos.create({ title: "buy milk" })).toBeOkWith(
      expect.objectContaining({ title: "buy milk", completed: false }),
    );
    await expect(rc.todos.list()).toBeOkWith([expect.objectContaining({ title: "buy milk" })]);
  });

  it("gets a created todo by id", async () => {
    const rc = clientFor(await buildApp());

    const created = await rc.todos.create({ title: "walk the dog" });
    const id = created.match({
      ok: (todo) => todo.id,
      err: () => {
        throw new Error("create failed");
      },
      defect: () => {
        throw new Error("create defected");
      },
    });

    await expect(rc.todos.get({ id })).toBeOkWith(
      expect.objectContaining({ id, title: "walk the dog" }),
    );
  });

  it("surfaces a missing id as a TYPED NOT_FOUND error", async () => {
    const rc = clientFor(await buildApp());

    await expect(rc.todos.get({ id: "nope" })).toBeErrWith(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});
