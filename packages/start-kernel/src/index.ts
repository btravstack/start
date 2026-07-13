// @btravstack/start-kernel — the process spine every btravstack start host reuses:
//   • defineConfig            — factor III, a zod config layer read once at the edge
//   • runHost                 — factor IX, build with `scoped`, serve, tear down on a signal
//   • defineContract          — the zod-first, transport-neutral I/O boundary
//   • handler / handler.use   — bind a contract to a demesne-injected edge
//   • runHandler              — the per-invocation fork+validate+dispatch a host reuses
//   • DispositionMap / dispatch — the total domain-error → transport-disposition map
//
// demesne does the wiring; unthrown carries the errors; 12-factor falls out. The concrete
// per-transport hosts (start-api / start-amqp / start-temporal) build on `runHandler` +
// `DispositionMap`; a formal `Host` interface is deferred until start-api implements one.

export { ConfigError, type ConfigModule, type ConfigTag, defineConfig } from "./config.js";
export { type Contract, ContractError, defineContract, parseInput } from "./contract.js";
export {
  type BoundHandler,
  dispatch,
  type DispositionMap,
  handler,
  runHandler,
} from "./handler.js";
export { runHost, type RunHostOptions } from "./host.js";
