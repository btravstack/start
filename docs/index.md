---
layout: home
title: start — type-safe, 12-factor backend applications
description: One demesne graph, many transport hosts. A contract, a handler, and a host per invocation — HTTP, AMQP and Temporal over one kernel. TanStack Start, but for a backend.

hero:
  name: "start"
  text: "The stack, assembled"
  tagline: Type-safe, 12-factor backend applications — one demesne graph, many transport hosts. TanStack Start, but for a backend.
  image:
    light: /logo-light.svg
    dark: /logo-dark.svg
    alt: start
  actions:
    - theme: brand
      text: The idea
      link: /guide/the-idea
    - theme: alt
      text: Status
      link: /guide/status
    - theme: alt
      text: GitHub
      link: https://github.com/btravstack/start

features:
  - icon: { src: /icons/hosts.svg }
    title: One graph, many hosts
    details: Your application is a demesne graph — pure use cases behind ports. Serve that same graph over HTTP, AMQP or Temporal; only the host changes.
  - icon: { src: /icons/spine.svg }
    title: A shared process spine
    details: Config (factor III), the DI graph, the error channel and graceful shutdown (factor IX) are shared across every transport.
  - icon: { src: /icons/contract.svg }
    title: A contract per invocation
    details: A zod contract + a demesne-injected handler + a host that owns the process. Hosts are pure transport glue over the kernel's runHandler.
  - icon: { src: /icons/flask.svg }
    title: Proven against real infrastructure
    details: Every example ships a test:integration suite that runs against real Postgres, RabbitMQ and Temporal via testcontainers.
---

<div class="btv-wip">
  <img src="/beet-worker.svg" alt="A beetroot in a hard hat, digging" />
  <p><strong>Under construction.</strong> start is incubating — all packages are currently <code>private</code> while the API settles. The RFCs in <a href="https://github.com/btravstack/start/tree/main/design" target="_blank" rel="noopener">design/</a> are the source of truth, and everything here may change without ceremony.</p>
</div>

## The idea

Your application is a **demesne graph** — pure use cases behind ports, adapters wired at the
boundary, everything discharged before you run. start adds the process spine and lets you serve
that _same graph_ over any transport:

> a **contract** (zod input / output) + a **handler** (a demesne-injected use case) + a **host**
> (owns the process, opens a fork scope per invocation)

The host is the only thing that changes between transports. Config, the DI graph, the error
channel, and graceful shutdown are shared.

| Host                         | Disposition `D`             | Invocation unit |
| ---------------------------- | --------------------------- | --------------- |
| `@btravstack/start-api`      | HTTP status                 | per request     |
| `@btravstack/start-amqp`     | ack / requeue / dead-letter | per message     |
| `@btravstack/start-temporal` | retryable / non-retryable   | per activity    |

Each host is **pure transport glue** over the kernel's `runHandler` + a total `DispositionMap` —
no DI, lifecycle, validation, or dispatch logic of its own.

## Built on the stack

start is where the [BtravStack](https://btravstack.github.io/) packages meet:
[demesne](https://btravstack.github.io/demesne/) does the wiring,
[unthrown](https://btravstack.github.io/unthrown/) carries the errors, and 12-factor falls out of
building your app as a graph.
