// End-to-end test: assemble the app through `bootstrap` (in-memory repo), build the graph, and
// drive the Hono app in-process with `app.request` — no socket, no running server. This proves the
// whole btravstack start stack composes: config → wired use cases → start-api host.
import { HttpApp } from "@btravstack/start-api";
import { Layer } from "demesne";
import { describe, expect, it } from "vitest";

import { bootstrap } from "./bootstrap.js";
import { ConfigLive } from "./config.js";
import { TodoRepoLive } from "./infra/adapters.js";

type TodoBody = { readonly id: string; readonly title: string; readonly completed: boolean };

const buildApp = async () => {
  const graph = Layer.merge(ConfigLive, Layer.provideTo(bootstrap(TodoRepoLive), ConfigLive));
  const built = await Layer.build(graph);
  return built.match({
    ok: (ctx) => ctx.get(HttpApp),
    err: (error) => {
      throw new Error(`build failed: ${error._tag}`);
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

const postTodo = (app: Awaited<ReturnType<typeof buildApp>>, title: string) =>
  app.request("/todos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

describe("start-api-todo", () => {
  it("creates, lists, and gets a todo across the full stack", async () => {
    const app = await buildApp();

    const created = await postTodo(app, "buy milk");
    expect(created.status).toBe(200);
    const todo = (await created.json()) as TodoBody;
    expect(todo).toMatchObject({ title: "buy milk", completed: false });

    const listed = await app.request("/todos");
    expect(listed.status).toBe(200);
    expect((await listed.json()) as readonly TodoBody[]).toEqual([
      expect.objectContaining({ title: "buy milk" }),
    ]);

    const got = await app.request(`/todos/${todo.id}`);
    expect(got.status).toBe(200);
    expect((await got.json()) as TodoBody).toMatchObject({ id: todo.id, title: "buy milk" });
  });

  it("maps a missing todo to 404 via the disposition map", async () => {
    const app = await buildApp();
    const res = await app.request("/todos/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("rejects invalid input with 400 before the handler runs", async () => {
    const app = await buildApp();
    const res = await postTodo(app, "");
    expect(res.status).toBe(400);
  });
});
