# Examples

Each example in [`examples/`](https://github.com/btravstack/start/tree/main/examples) is a
complete application with a `test:integration` suite that runs against **real infrastructure**
via [testcontainers](https://testcontainers.com):

- **`start-api-todo`** — plain HTTP + in-memory repo (the base example).
- **`start-orpc-prisma`** — a typed [oRPC](https://orpc.unnoq.com) API backed by Prisma/Postgres.
- **`start-amqp-worker`** — a RabbitMQ consumer via a real amqplib driver.
- **`start-temporal-worker`** — a Temporal worker + deterministic workflow.

The examples are the executable form of the design RFCs: one demesne graph per app, served through
a host, with config, wiring, errors and shutdown shared. While the packages are private, the
examples are the best way to read how start feels to use.
