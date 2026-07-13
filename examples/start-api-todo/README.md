# @demesne-examples/start-api-todo

A complete todo HTTP API built on **btravstack start** — the reference app the scaffolder would
emit. It wires nothing by hand that the framework already provides, and demonstrates the whole
stack composing:

```
config.ts              defineConfig(schema)                     — factor III
domain.ts              Todo + TaggedError domain errors
application/ports.ts   Logger, TodoRepository (demesne tags)
application/use-cases  GetTodo (Service) · CreateTodo/ListTodos (inject)  — the 3 shapes
infra/adapters.ts      LoggerLive · TodoRepoLive (in-memory — the swappable adapter)
http/routes.ts         defineContract + handler.use + createHttpApp       — the host
bootstrap.ts           bootstrap(repository)                    — the test seam
app.ts                 assemble + httpListener (port from Config via ListenConfig)
server.ts              runHost(AppLayer)                        — factor IX
```

## What it demonstrates

- **12-factor falls out of the graph.** Config is read once (`defineConfig`), the listener port
  flows through the graph as a service (`ListenConfig` mapped from `Config`), shutdown is a
  scope close (`runHost` on SIGTERM), and swapping the repo is a `bootstrap(fake)` parameter.
- **One handler shape, three use-case shapes.** `handler.use` binds a `Service` class, an
  `inject` closure with an arg, and one with none — identically.
- **Errors declared once, mapped at the edge.** Use cases produce `TodoNotFound` /
  `RepositoryError`; the route's disposition map turns them into 404 / 500. No status code
  appears in a handler.

## Run

```sh
pnpm --filter @demesne-examples/start-api-todo dev    # tsx watch src/server.ts
pnpm --filter @demesne-examples/start-api-todo test   # end-to-end via app.request (no socket)
```

```sh
curl -X POST localhost:3000/todos -d '{"title":"buy milk"}' -H 'content-type: application/json'
curl localhost:3000/todos
curl localhost:3000/todos/1
```

## Swapping the adapter

`bootstrap(repository)` is generic over the repository layer. `app.ts` passes `TodoRepoLive`
(in-memory); a Postgres build would pass a Prisma-backed layer with the same `TodoRepository`
port, and every consumer — use cases, routes — stays unchanged. That is the deep, type-checked
test seam.

## Integration test

`pnpm --filter @demesne-examples/start-api-todo test:integration` — boots the REAL server
(`runHost`, ephemeral port), drives CRUD over an actual socket, and proves teardown closes the
listener. No Docker needed — the listener is this example's only infrastructure.
