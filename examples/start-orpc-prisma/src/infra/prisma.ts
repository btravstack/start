// The Prisma client as a demesne RESOURCE. `acquireRelease` connects on build and registers
// `$disconnect` with the scope, so the connection is tracked: the graph carries `Scope` and can
// only run under `runHost`. Prisma 7 uses a driver adapter (`@prisma/adapter-pg`); the client is
// `$extends`ed with `@unthrown/prisma` so every query returns an `AsyncResult` (the `try*` methods)
// whose error channel is the P-codes it can hit.
import { PrismaPg } from "@prisma/adapter-pg";
import { type Context, Layer, Tag } from "demesne";
import { fromPromise, TaggedError } from "unthrown";
import { unthrownPrisma } from "@unthrown/prisma";

import { Config, type ConfigId } from "../config.js";
import { PrismaClient } from "../generated/prisma/client.ts";

const makeClient = (connectionString: string) =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString }) }).$extends(unthrownPrisma);

export class Database extends Tag("@app/Database")<Database, ReturnType<typeof makeClient>>() {}

export class ConnectionError extends TaggedError("@app/ConnectionError", {
  name: "ConnectionError",
})<{
  readonly cause: unknown;
}> {}

export const DatabaseLive = Layer.acquireRelease(
  Database,
  (ctx: Context<ConfigId>) => {
    const client = makeClient(ctx.get(Config).DATABASE_URL);
    return fromPromise(
      client.$connect().then(() => client),
      (cause) => new ConnectionError({ cause }),
    );
  },
  (client) => client.$disconnect(),
);
