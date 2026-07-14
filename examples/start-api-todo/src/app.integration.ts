// Integration — drive the running todos API over a real socket with plain `fetch`: one request per
// test, each asserting the whole response (status and body together). Nothing here mentions
// `runHost`, demesne, or a context — all of that is quarantined in `./testkit/boot`. This file is
// transport-only, so it would stay byte-for-byte identical if start + demesne were swapped out.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boot, type BootedApp } from "./testkit/boot.js";

const post = (baseUrl: string, body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/todos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("start-api-todo over HTTP", () => {
  let app: BootedApp;
  // The in-memory repo persists across the suite, so the CRUD tests share the todo created first.
  let createdId: string;

  beforeAll(async () => {
    app = await boot();
  });
  afterAll(() => app.close());

  it("creates a todo", async () => {
    const res = await post(app.baseUrl, { title: "buy milk" });
    const body = (await res.json()) as { id: string };
    createdId = body.id;
    expect({ status: res.status, body }).toEqual({
      status: 200,
      body: { id: expect.any(String), title: "buy milk", completed: false },
    });
  });

  it("lists the todos", async () => {
    const res = await fetch(`${app.baseUrl}/todos`);
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: [{ id: createdId, title: "buy milk", completed: false }],
    });
  });

  it("gets a todo by id", async () => {
    const res = await fetch(`${app.baseUrl}/todos/${createdId}`);
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { id: createdId, title: "buy milk", completed: false },
    });
  });

  it("maps a missing todo to 404", async () => {
    const res = await fetch(`${app.baseUrl}/todos/does-not-exist`);
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 404,
      body: { error: "todo not found" },
    });
  });

  it("rejects invalid input with 400", async () => {
    const res = await post(app.baseUrl, { title: "" });
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 400,
      body: expect.objectContaining({ error: "invalid input" }),
    });
  });
});

describe("start-api-todo teardown", () => {
  it("stops accepting once the scope closes (factor IX: disposability)", async () => {
    const app = await boot();
    await app.close();
    await expect(fetch(`${app.baseUrl}/todos`)).rejects.toThrow();
  });
});
