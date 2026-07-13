// Integration: boot the REAL server — `runHost(AppLayer)` exactly as `server.ts` does — on an
// ephemeral port (PORT=0), drive it over an actual socket with fetch, then let the scope close
// and prove teardown (the port stops accepting). No containers needed: this example's only
// infrastructure is the HTTP listener itself.
import { HttpServer } from "@btravstack/start-api";
import { runHost } from "@btravstack/start-kernel";
import { fromSafePromise } from "unthrown";
import { describe, expect, it } from "vitest";

describe("start-api-todo (full boot)", () => {
  it("serves CRUD over a real socket and tears the listener down on scope close", async () => {
    process.env["PORT"] = "0";
    process.env["LOG_LEVEL"] = "warn";
    const { AppLayer } = await import("./app.js");

    let baseUrl = "";
    const outcome = await runHost(AppLayer, {
      use: (ctx) =>
        fromSafePromise(
          (async () => {
            baseUrl = `http://localhost:${ctx.get(HttpServer).port}`;

            const created = await fetch(`${baseUrl}/todos`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: "buy milk" }),
            });
            expect(created.status).toBe(200);
            const todo = (await created.json()) as { id: string; title: string };
            expect(todo).toMatchObject({ title: "buy milk" });

            const listed = await fetch(`${baseUrl}/todos`);
            expect(listed.status).toBe(200);
            expect(await listed.json()).toEqual([expect.objectContaining({ title: "buy milk" })]);

            const got = await fetch(`${baseUrl}/todos/${todo.id}`);
            expect(got.status).toBe(200);

            const missing = await fetch(`${baseUrl}/todos/does-not-exist`);
            expect(missing.status).toBe(404);

            const invalid = await fetch(`${baseUrl}/todos`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title: "" }),
            });
            expect(invalid.status).toBe(400);
          })(),
        ),
    });

    outcome.match({
      ok: () => undefined,
      err: (error) => expect.unreachable(`startup failed: ${error._tag}`),
      defect: (cause) => expect.unreachable(`panic: ${String(cause)}`),
    });

    // The scope has closed — the listener must be gone (factor IX: disposability).
    await expect(fetch(`${baseUrl}/todos`)).rejects.toThrow();
  });
});
