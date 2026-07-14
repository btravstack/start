// Integration — drive the running todos API over a real socket with plain `fetch`: one request per
// test, each asserting the whole response (status and body together). Nothing here mentions
// `runHost`, demesne, or a context — all of that is quarantined in `./testkit/boot`. This file is
// transport-only, so it would stay identical if start + demesne were swapped out.
//
// Each test gets its own freshly-booted app through the `app` fixture, so the in-memory repo starts
// empty every time: tests are autonomous and order-independent (no shared seed row).
import { it as base, describe, expect } from "vitest";

import { boot, type BootedApp } from "./testkit/boot.js";

const it = base.extend<{ app: BootedApp }>({
  // vitest requires the fixture's first arg to be an object-destructuring pattern; this fixture
  // pulls no other fixtures, so it is empty.
  // oxlint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const app = await boot();
    // `finally` so the listener is always torn down — even if the test (i.e. `use`) throws on an
    // assertion failure or timeout, which would otherwise leak a running server into later tests.
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

// A Response can't be compared with `toEqual` directly (its body is a one-shot stream and it
// carries internal fields), so collapse it to an assertable snapshot and match the whole thing.
const responseOf = async (res: Response): Promise<{ status: number; body: unknown }> => ({
  status: res.status,
  body: await res.json(),
});

const postTodo = (baseUrl: string, title: string): Promise<Response> =>
  fetch(`${baseUrl}/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

describe("start-api-todo over HTTP", () => {
  it("creates a todo", async ({ app }) => {
    expect(await responseOf(await postTodo(app.baseUrl, "buy milk"))).toEqual({
      status: 200,
      body: { id: expect.any(String), title: "buy milk", completed: false },
    });
  });

  it("lists the todos", async ({ app }) => {
    const created = (await (await postTodo(app.baseUrl, "buy milk")).json()) as { id: string };

    expect(await responseOf(await fetch(`${app.baseUrl}/todos`))).toEqual({
      status: 200,
      body: [{ id: created.id, title: "buy milk", completed: false }],
    });
  });

  it("gets a todo by id", async ({ app }) => {
    const created = (await (await postTodo(app.baseUrl, "buy milk")).json()) as { id: string };

    expect(await responseOf(await fetch(`${app.baseUrl}/todos/${created.id}`))).toEqual({
      status: 200,
      body: { id: created.id, title: "buy milk", completed: false },
    });
  });

  it("maps a missing todo to 404", async ({ app }) => {
    expect(await responseOf(await fetch(`${app.baseUrl}/todos/does-not-exist`))).toEqual({
      status: 404,
      body: { error: "todo not found" },
    });
  });

  it("rejects invalid input with 400", async ({ app }) => {
    expect(await responseOf(await postTodo(app.baseUrl, ""))).toEqual({
      status: 400,
      body: expect.objectContaining({ error: "invalid input" }),
    });
  });
});

describe("start-api-todo teardown", () => {
  // Boots its own app (the `app` fixture is lazy and never triggered here) so it can assert on the
  // world *after* the scope has closed — something the auto-closing fixture can't express.
  it("stops accepting once the scope closes (factor IX: disposability)", async () => {
    const app = await boot();
    await app.close();
    await expect(fetch(`${app.baseUrl}/todos`)).rejects.toThrow();
  });
});
