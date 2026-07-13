# @btravstack/start-api

> Incubating. The HTTP host for **btravstack start** — the first concrete host over
> `@btravstack/start-kernel`. See `design/btravstack-start*.md` at the repo root.

Serve demesne-wired contracts over Hono. Each request forks its own scope, validates input
against the contract, dispatches to the handler, and translates the outcome to an HTTP
response — **domain errors are mapped by a total disposition map** (no status code ever lives
inside a handler). This package is pure transport glue; all DI / lifecycle / validation /
dispatch logic lives in the kernel.

```ts
const app = createHttpApp<AppServices>()(RequestScopeLive)
  .route({
    method: "POST",
    path: "/todos",
    handler: handler.use(CreateTodoContract, CreateTodo, (create, input) => create(input.title)),
    errors: { "@app/RepositoryError": () => api.error(500, { error: "storage" }) },
  })
  .build(); // Layer<HttpApp, never, AppServices>

// serve it as a resource, torn down on shutdown. The listener reads its port from the
// `ListenConfig` service, which the app provides (e.g. mapped from its validated config):
const ListenConfigLive = Layer.inject(ListenConfig, { config: Config }, ({ config }) => ({
  port: config.PORT,
}));
const base = Layer.merge(app, Layer.provideTo(ListenConfigLive, app));
const graph = Layer.merge(base, Layer.provideTo(httpListener(), base));
await runHost(graph, { onReady: (ctx) => ctx.get(Logger).info("ready") });
```

## Surface

- **`createHttpApp<Parent>()(requestLayer)`** — a builder; `.route(spec)` adds a
  contract+handler+disposition-map route, `.build()` yields the Hono app as a demesne
  service (`HttpApp`, the fork parent for each request).
- **`httpListener()`** — the Node listener as an `acquireRelease` resource (carries `Scope`, so
  it runs under `runHost` and closes on shutdown). Reads its port from the **`ListenConfig`**
  service the app provides (`Layer.value(ListenConfig, { port })` for a static port, or
  `Layer.inject` mapped from your config for factor III).
- **`api.error(status, body?)`** — build an HTTP disposition for a domain error.

## Not here yet

End-to-end typed clients (oRPC) layered on top of this host — see the `start-orpc-prisma`
example, which mounts an oRPC router as this host's `HttpApp` service.
