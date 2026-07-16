# Status

<div class="btv-wip">
  <img src="/beet-worker.svg" alt="A beetroot in a hard hat, digging" />
  <p><strong>start is incubating.</strong> All packages are currently <code>private</code> while the API settles — nothing is published to npm yet, and everything may change without ceremony.</p>
</div>

## What that means in practice

- **No install instructions.** The `@btravstack/start-*` packages are not on npm. When the kernel
  API stabilises, they will be published and this site will grow real getting-started guides.
- **The design RFCs are the source of truth.** The documents in
  [`design/`](https://github.com/btravstack/start/tree/main/design) are invariant-driven and
  reviewed before code; when the code and an RFC disagree, the RFC wins until amended.
- **The examples are real.** Each example application in the repo ships a `test:integration`
  suite that runs against real infrastructure (Postgres, RabbitMQ, Temporal) via
  [testcontainers](https://testcontainers.com) — the design is exercised end-to-end on every CI
  run, even while incubating.

## Following along

Watch the [GitHub repository](https://github.com/btravstack/start) for progress. The rest of the
stack — [amqp-contract](https://btravstack.github.io/amqp-contract/),
[temporal-contract](https://btravstack.github.io/temporal-contract/),
[unthrown](https://btravstack.github.io/unthrown/) and
[demesne](https://btravstack.github.io/demesne/) — is published and documented today.
