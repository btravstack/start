// Composition — the in-memory-backed application plus the HTTP listener. The app maps its
// validated `Config` into the listener's `ListenConfig` service (factor III: the port comes from
// config, flowing through the graph). The listener is an `acquireRelease` resource, so the graph
// carries `Scope` and can only be run with `runHost`.
import { httpListener, ListenConfig } from "@btravstack/start-api";
import { Layer } from "demesne";

import { Config, ConfigLive } from "./config.js";
import { bootstrap } from "./bootstrap.js";
import { TodoRepoLive } from "./infra/adapters.js";

const ListenConfigLive = Layer.inject(ListenConfig, { config: Config }, ({ config }) => ({
  port: config.PORT,
}));

// Discharge `Config` once for both the app and the listener config; `ConfigLive` builds once
// (shared by reference).
const base = Layer.provideTo(Layer.merge(bootstrap(TodoRepoLive), ListenConfigLive), ConfigLive);

export const AppLayer = Layer.merge(base, Layer.provideTo(httpListener(), base));
