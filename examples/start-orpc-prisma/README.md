# @demesne-examples/start-orpc-prisma

A typed **oRPC** HTTP API on **btravstack start**, backed by **Prisma/Postgres** — the "complete"
API example: real DB adapter, end-to-end typed client, on the kernel.

```
config.ts                 defineConfig (DATABASE_URL, PORT)          — factor III
domain.ts                 Todo + domain errors
application/               Logger, TodoRepository ports · 3 use cases
infra/prisma.ts            Prisma client as an acquireRelease resource (driver adapter)
infra/todo-repository.ts   TodoRepository backed by Prisma (@unthrown/prisma try* methods)
http/router.ts             oRPC router → start-api's HttpApp service (typed errors)
bootstrap.ts               bootstrap(repository)                     — the test seam
app.ts                     Prisma repo + start-api's httpListener (port from Config)
server.ts                  runHost(AppLayer)                         — factor IX
```

## What it shows

- **Kernel + oRPC + Prisma compose.** The process spine is the kernel (`defineConfig`, `runHost`,
  the `bootstrap(repository)` seam) and start-api's `httpListener`; oRPC is the typed HTTP
  transport; Prisma is the storage adapter. The oRPC app is built as start-api's `HttpApp` service,
  so the framework's listener serves it.
- **End-to-end typed errors.** Each procedure's declared `errors` (`NOT_FOUND`, `STORAGE_FAILED`)
  are inferred into the client's error channel via `@unthrown/orpc`; the domain→transport `mapErr`
  is the oRPC-native form of the disposition map.
- **Prisma as an acquireRelease resource.** The connection is a tracked resource — the graph
  carries `Scope` and `runHost` disconnects the pool on shutdown.
- **Deep, type-checked test seam.** `bootstrap(repository)` swaps the Prisma repo for an in-memory
  fake; the test drives the real app through a typed oRPC client with no database.

## Run

```sh
# a Postgres, then apply the schema:
DATABASE_URL=postgres://... pnpm --filter @demesne-examples/start-orpc-prisma exec prisma migrate dev
DATABASE_URL=postgres://... pnpm --filter @demesne-examples/start-orpc-prisma dev
pnpm --filter @demesne-examples/start-orpc-prisma test   # typed client over a fake repo — no DB
```

## Integration test

`pnpm --filter @demesne-examples/start-orpc-prisma test:integration` — the full stack against a
real Postgres via testcontainers (Docker required): `prisma db push`, `runHost` boots Prisma +
listener, a typed oRPC client drives it over an actual socket (including the Prisma-P2025 →
`NOT_FOUND` path), and teardown is asserted.
