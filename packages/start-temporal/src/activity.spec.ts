import { defineContract, handler } from "@btravstack/start-kernel";
import { Layer, type ServiceOf, Tag } from "demesne";
import { type AsyncResult, Err, Ok, TaggedError } from "unthrown";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ActivityRegistry, createActivities } from "./activity.js";
import { temporal } from "./disposition.js";

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

const buildActivities = async (
  create: (title: string) => AsyncResult<Todo, RepoError>,
): Promise<ServiceOf<ActivityRegistry>["activities"]> => {
  const repo = Layer.value(Repo, { create });
  const parent = Layer.merge(repo, Layer.provideTo(CreateTodoLive, repo));

  const registryLayer = createActivities<Repo | CreateTodo>()(RequestIdLive)
    .activity({
      name: "createTodo",
      handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
      errors: {
        "@test/RepoError": (error) =>
          error.cause === "transient" ? temporal.retryable() : temporal.nonRetryable("permanent"),
      },
    })
    .build();

  const built = await Layer.build(Layer.provideTo(registryLayer, parent));
  return built.match({
    ok: (ctx) => ctx.get(ActivityRegistry).activities,
    err: () => {
      throw new Error("unexpected build error");
    },
    defect: (cause) => {
      throw cause;
    },
  });
};

const run = (
  activities: ServiceOf<ActivityRegistry>["activities"],
  name: string,
  input: unknown,
): Promise<unknown> => {
  const fn = activities[name];
  if (fn === undefined) throw new Error(`no activity ${name}`);
  return fn(input);
};

describe("createActivities", () => {
  it("returns the handler output on success", async () => {
    const activities = await buildActivities((title) => Ok({ id: "t1", title }).toAsync());
    await expect(run(activities, "createTodo", { title: "buy milk" })).resolves.toEqual({
      id: "t1",
      title: "buy milk",
    });
  });

  it("throws a NON-retryable failure for malformed input (ContractError)", async () => {
    const activities = await buildActivities((title) => Ok({ id: "t1", title }).toAsync());
    await expect(run(activities, "createTodo", { title: "" })).rejects.toMatchObject({
      name: "TemporalActivityFailure",
      retryable: false,
    });
  });

  it("throws a RETRYABLE failure for a transient domain error", async () => {
    const activities = await buildActivities(() =>
      Err(new RepoError({ cause: "transient" })).toAsync(),
    );
    await expect(run(activities, "createTodo", { title: "x" })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it("throws a NON-retryable failure for a permanent domain error", async () => {
    const activities = await buildActivities(() =>
      Err(new RepoError({ cause: "fatal" })).toAsync(),
    );
    await expect(run(activities, "createTodo", { title: "x" })).rejects.toMatchObject({
      retryable: false,
      reason: "permanent",
    });
  });

  it("treats an activity-scope build failure (RErr — outside the map) as RETRYABLE, naming the tag", async () => {
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
    const registryLayer = createActivities<Repo | CreateTodo>()(failingRequestLayer)
      .activity({
        name: "createTodo",
        handler: handler.use(contract, CreateTodo, (fn, input) => fn(input.title)),
        errors: { "@test/RepoError": () => temporal.nonRetryable("unreachable") },
      })
      .build();
    const built = await Layer.build(Layer.provideTo(registryLayer, parent));
    const activities = built.match({
      ok: (ctx) => ctx.get(ActivityRegistry).activities,
      err: () => {
        throw new Error("unexpected build error");
      },
      defect: (cause) => {
        throw cause;
      },
    });

    await expect(run(activities, "createTodo", { title: "x" })).rejects.toMatchObject({
      retryable: true,
      reason: expect.stringContaining("@test/ScopeDown"),
    });
  });
});
