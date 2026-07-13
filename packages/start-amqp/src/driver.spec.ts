import { defineContract, handler } from "@btravstack/start-kernel";
import { Layer, Tag } from "demesne";
import { type AsyncResult, Err, fromSafePromise, Ok, TaggedError } from "unthrown";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { type AmqpDisposition, amqp } from "./disposition.js";
import {
  type AmqpDelivery,
  type AmqpDriver,
  Consumer,
  type IdempotencyStore,
  runConsumer,
} from "./driver.js";
import { createConsumer } from "./router.js";

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

// A fake broker: capture the settle callback per queue so the test can push deliveries and read
// back the disposition the host chose, and count cancellations on teardown.
const makeFakeDriver = () => {
  const callbacks = new Map<string, (d: AmqpDelivery) => Promise<AmqpDisposition>>();
  let cancelled = 0;
  const driver: AmqpDriver = {
    consume: (queue, onDelivery) => {
      callbacks.set(queue, onDelivery);
      return Promise.resolve({
        cancel: () => {
          callbacks.delete(queue);
          cancelled += 1;
          return Promise.resolve();
        },
      });
    },
  };
  const push = (delivery: AmqpDelivery): Promise<AmqpDisposition> => {
    const onDelivery = callbacks.get(delivery.queue);
    if (onDelivery === undefined) throw new Error(`no subscription for ${delivery.queue}`);
    return onDelivery(delivery);
  };
  return { driver, push, cancelled: () => cancelled };
};

const makeMemoryStore = (): IdempotencyStore => {
  const seen = new Set<string>();
  return {
    seen: (id) => Promise.resolve(seen.has(id)),
    record: (id) => {
      seen.add(id);
      return Promise.resolve();
    },
  };
};

const routerFor = (create: (title: string) => AsyncResult<Todo, RepoError>) => {
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
  return Layer.provideTo(routerLayer, parent);
};

describe("runConsumer", () => {
  it("subscribes, acks a delivery, dedupes redelivery by id, and cancels on scope close", async () => {
    let calls = 0;
    const router = routerFor((title) => {
      calls += 1;
      return Ok({ id: "t1", title }).toAsync();
    });
    const { driver, push, cancelled } = makeFakeDriver();
    const consumer = Layer.provideTo(
      runConsumer({ driver, queues: ["todos.create"], idempotency: makeMemoryStore() }),
      router,
    );

    const outcome = await Layer.scoped(consumer, (ctx) =>
      fromSafePromise(
        (async () => {
          void ctx.get(Consumer);
          const first = await push({
            queue: "todos.create",
            messageId: "m1",
            body: { title: "a" },
          });
          const second = await push({
            queue: "todos.create",
            messageId: "m1",
            body: { title: "a" },
          });
          return { first, second };
        })(),
      ),
    );

    outcome.match({
      ok: ({ first, second }) => {
        expect(first).toEqual({ kind: "ack" });
        expect(second).toEqual({ kind: "ack" });
      },
      err: () => expect.unreachable("no err"),
      defect: () => expect.unreachable("no defect"),
    });
    expect(calls).toBe(1); // the duplicate was deduped, not reprocessed
    expect(cancelled()).toBe(1); // subscription torn down on scope close
  });

  it("does not record a failed delivery, so a later redelivery is reprocessed", async () => {
    let attempt = 0;
    const router = routerFor((title) => {
      attempt += 1;
      return attempt === 1
        ? Err(new RepoError({ cause: "transient" })).toAsync()
        : Ok({ id: "t1", title }).toAsync();
    });
    const { driver, push } = makeFakeDriver();
    const consumer = Layer.provideTo(
      runConsumer({ driver, queues: ["todos.create"], idempotency: makeMemoryStore() }),
      router,
    );

    const outcome = await Layer.scoped(consumer, () =>
      fromSafePromise(
        (async () => {
          const first = await push({
            queue: "todos.create",
            messageId: "m9",
            body: { title: "a" },
          });
          const second = await push({
            queue: "todos.create",
            messageId: "m9",
            body: { title: "a" },
          });
          return { first, second };
        })(),
      ),
    );

    outcome.match({
      ok: ({ first, second }) => {
        expect(first).toEqual({ kind: "requeue" }); // transient failure, not recorded
        expect(second).toEqual({ kind: "ack" }); // redelivery reprocessed and succeeded
      },
      err: () => expect.unreachable("no err"),
      defect: () => expect.unreachable("no defect"),
    });
    expect(attempt).toBe(2);
  });

  it("still ACKS when the store's record fails after successful processing (no forced duplicate)", async () => {
    let calls = 0;
    const router = routerFor((title) => {
      calls += 1;
      return Ok({ id: "t1", title }).toAsync();
    });
    const { driver, push } = makeFakeDriver();
    const brokenRecordStore: IdempotencyStore = {
      seen: () => Promise.resolve(false),
      record: () => Promise.reject(new Error("store down")),
    };
    const consumer = Layer.provideTo(
      runConsumer({ driver, queues: ["todos.create"], idempotency: brokenRecordStore }),
      router,
    );

    const outcome = await Layer.scoped(consumer, () =>
      fromSafePromise(push({ queue: "todos.create", messageId: "m2", body: { title: "a" } })),
    );

    outcome.match({
      // The message WAS processed — requeuing on a failed record would guarantee a duplicate.
      ok: (disposition) => expect(disposition).toEqual({ kind: "ack" }),
      err: () => expect.unreachable("no err"),
      defect: () => expect.unreachable("no defect"),
    });
    expect(calls).toBe(1);
  });

  it("requeues (without processing) when the store's seen check fails", async () => {
    let calls = 0;
    const router = routerFor((title) => {
      calls += 1;
      return Ok({ id: "t1", title }).toAsync();
    });
    const { driver, push } = makeFakeDriver();
    const brokenSeenStore: IdempotencyStore = {
      seen: () => Promise.reject(new Error("store down")),
      record: () => Promise.resolve(),
    };
    const consumer = Layer.provideTo(
      runConsumer({ driver, queues: ["todos.create"], idempotency: brokenSeenStore }),
      router,
    );

    const outcome = await Layer.scoped(consumer, () =>
      fromSafePromise(push({ queue: "todos.create", messageId: "m3", body: { title: "a" } })),
    );

    outcome.match({
      ok: (disposition) => expect(disposition).toEqual({ kind: "requeue" }),
      err: () => expect.unreachable("no err"),
      defect: () => expect.unreachable("no defect"),
    });
    expect(calls).toBe(0); // nothing was processed yet — the retry is safe
  });

  it("keeps subscriptions PER BUILD: closing an inner scope leaves the outer scope's consumers active", async () => {
    const cancelCounts: number[] = [];
    const driver: AmqpDriver = {
      consume: () => {
        const index = cancelCounts.push(0) - 1;
        return Promise.resolve({
          cancel: () => {
            cancelCounts[index] = (cancelCounts[index] ?? 0) + 1;
            return Promise.resolve();
          },
        });
      },
    };
    const router = routerFor((title) => Ok({ id: "t1", title }).toAsync());
    // ONE layer reference, built in two separate scopes — separate builds must reconstruct
    // and tear down independently (the demesne per-build contract).
    const consumer = Layer.provideTo(runConsumer({ driver, queues: ["todos.create"] }), router);

    const outcome = await Layer.scoped(consumer, () =>
      fromSafePromise(
        (async () => {
          // open and close a SECOND, independent build of the same reference
          await Layer.scoped(consumer, () => Ok("inner").toAsync());
          // the inner scope closed its own subscription (index 1) — the outer's (index 0)
          // must still be live
          return [...cancelCounts];
        })(),
      ),
    );

    outcome.match({
      ok: (countsAfterInnerClose) => expect(countsAfterInnerClose).toEqual([0, 1]),
      err: () => expect.unreachable("no err"),
      defect: () => expect.unreachable("no defect"),
    });
    // after the outer scope closed too, each subscription was cancelled exactly once
    expect(cancelCounts).toEqual([1, 1]);
  });

  it("cancels already-opened subscriptions when a later consume fails during acquire", async () => {
    let cancelled = 0;
    const driver: AmqpDriver = {
      consume: (queue) => {
        if (queue === "q.fails") return Promise.reject(new Error("broker rejected consumer"));
        return Promise.resolve({
          cancel: () => {
            cancelled += 1;
            return Promise.resolve();
          },
        });
      },
    };
    const router = routerFor((title) => Ok({ id: "t1", title }).toAsync());
    const consumer = Layer.provideTo(
      runConsumer({ driver, queues: ["todos.create", "q.fails"] }),
      router,
    );

    const outcome = await Layer.scoped(
      consumer,
      (): AsyncResult<never, never> => expect.unreachable("use must not run — the build failed"),
    );

    outcome.match({
      ok: () => expect.unreachable("expected Err"),
      err: (error) => expect(error._tag).toBe("@btravstack/start-amqp/ConsumeError"),
      defect: () => expect.unreachable("no defect"),
    });
    // the first queue's subscription must not leak past the failed acquire
    expect(cancelled).toBe(1);
  });
});
