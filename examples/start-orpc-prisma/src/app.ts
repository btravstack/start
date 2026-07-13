// Composition — the Prisma-backed application plus the HTTP listener. `DatabaseLive` is an
// `acquireRelease` resource, so the graph carries `Scope` and can only run with `runHost` (which
// disconnects Prisma on shutdown). The listener port comes from Config via start-api's
// `ListenConfig`.
import { httpListener, ListenConfig } from "@btravstack/start-api";
import { Layer } from "demesne";

import { Config, ConfigLive } from "./config.js";
import { bootstrap } from "./bootstrap.js";
import { DatabaseLive } from "./infra/prisma.js";
import { TodoRepoLive } from "./infra/todo-repository.js";

// The Prisma-backed repository: config → database → repository. `dbWired` is shared by reference,
// so Prisma connects once. Provides Config/Database/TodoRepository and carries `Scope`.
const dbWired = Layer.provideTo(DatabaseLive, ConfigLive);
const PrismaRepository = Layer.merge(ConfigLive, dbWired, Layer.provideTo(TodoRepoLive, dbWired));

const boot = bootstrap(PrismaRepository);

const ListenConfigLive = Layer.inject(ListenConfig, { config: Config }, ({ config }) => ({
  port: config.PORT,
}));

const base = Layer.merge(boot, Layer.provideTo(ListenConfigLive, boot));

export const AppLayer = Layer.merge(base, Layer.provideTo(httpListener(), base));
