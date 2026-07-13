// Integration: the WHOLE stack against a real Postgres (testcontainers). The schema is applied
// with `prisma db push`, the app boots via `runHost(AppLayer)` exactly as `server.ts` does —
// Prisma connects (acquireRelease), the listener opens on an ephemeral port — and a TYPED oRPC
// client drives it over an actual socket. Teardown is part of the assertion: when the scope
// closes, Prisma disconnects and the port stops accepting.
import { execFileSync } from "node:child_process";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { HttpServer } from "@btravstack/start-api";
import { runHost } from "@btravstack/start-kernel";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createResultClient } from "@unthrown/orpc/client";
import { fromSafePromise } from "unthrown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TodoRouter } from "./http/router.js";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();

  // Apply the Prisma schema to the fresh database (no migrations dir in this example; Prisma 7's
  // `db push` no longer runs generate, so no flag is needed to skip it).
  execFileSync("pnpm", ["exec", "prisma", "db", "push"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  process.env["DATABASE_URL"] = url;
  process.env["PORT"] = "0";
  process.env["LOG_LEVEL"] = "warn";
});

afterAll(async () => {
  await container.stop();
});

// This oRPC beta types `url` as a PATH (`/${string}`); the custom fetch resolves it against the
// real listener — same pattern as the unit test's in-process client, but over an actual socket.
const typedClientFor = (port: number) =>
  createResultClient(
    createORPCClient<RouterClient<TodoRouter>>(
      new RPCLink({
        url: "/rpc",
        fetch: async (url, init) => fetch(new URL(String(url), `http://localhost:${port}`), init),
      }),
    ),
  );

describe("start-orpc-prisma (full stack vs real Postgres)", () => {
  it("boots, serves the typed oRPC API backed by Prisma, and tears down cleanly", async () => {
    const { AppLayer } = await import("./app.js");

    let baseUrl = "";
    const outcome = await runHost(AppLayer, {
      use: (ctx) =>
        fromSafePromise(
          (async () => {
            const port = ctx.get(HttpServer).port;
            baseUrl = `http://localhost:${port}`;
            const rc = typedClientFor(port);

            // create → a REAL row in Postgres
            const created = await rc.todos.create({ title: "buy milk" });
            const id = created.match({
              ok: (todo) => {
                expect(todo).toMatchObject({ title: "buy milk", completed: false });
                return todo.id;
              },
              err: (error) => {
                throw new Error(`create failed: ${error.code}`);
              },
              defect: (cause) => {
                throw new Error(`create defected: ${String(cause)}`);
              },
            });

            // list + get read the row back through Prisma
            const listed = await rc.todos.list();
            listed.match({
              ok: (todos) =>
                expect(todos).toEqual([expect.objectContaining({ id, title: "buy milk" })]),
              err: () => expect.unreachable("list failed"),
              defect: () => expect.unreachable("list defected"),
            });

            const got = await rc.todos.get({ id });
            got.match({
              ok: (todo) => expect(todo).toMatchObject({ id, title: "buy milk" }),
              err: () => expect.unreachable("get failed"),
              defect: () => expect.unreachable("get defected"),
            });

            // Prisma's P2025 → domain TodoNotFound → typed NOT_FOUND, end to end
            const missing = await rc.todos.get({ id: "00000000-0000-0000-0000-000000000000" });
            missing.match({
              ok: () => expect.unreachable("expected NOT_FOUND"),
              err: (error) => expect(error.code).toBe("NOT_FOUND"),
              defect: (cause) => expect.unreachable(`defect: ${String(cause)}`),
            });
          })(),
        ),
    });

    outcome.match({
      ok: () => undefined,
      err: (error) => expect.unreachable(`startup failed: ${error._tag}`),
      defect: (cause) => expect.unreachable(`panic: ${String(cause)}`),
    });

    // Scope closed: listener gone (Prisma disconnected right after it, LIFO).
    await expect(fetch(`${baseUrl}/todos`)).rejects.toThrow();
  });
});
