// Integration: the WHOLE consumer against a real RabbitMQ (testcontainers), through the REAL
// amqplib driver — the exact wiring `server.ts` runs. A publisher connection pushes messages onto
// the queue; the consumer must pick them up, run the demesne-wired handler, and settle them:
//   • a valid charge   → handler runs, message ACKED           (queue drains)
//   • an over-limit    → PaymentDeclined → dead-letter (nack, no requeue — queue drains, no loop)
//   • a malformed body → ContractError → dead-letter           (poison message, no loop)
// A requeue-loop bug would keep messageCount > 0 — the drain assertions are the regression net.
import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { runHost } from "@btravstack/start-kernel";
import { runConsumer } from "@btravstack/start-amqp";
import { Layer } from "demesne";
import * as amqplib from "amqplib";
import { fromSafePromise } from "unthrown";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bootstrap } from "./bootstrap.js";
import { CHARGE_QUEUE } from "./consumer.js";
import { ConfigLive } from "./config.js";
import { type AmqpConnection, createAmqpDriver } from "./infra/amqp-driver.js";
import { PaymentsLive } from "./infra/payments.js";

let container: StartedRabbitMQContainer;
let url = "";

beforeAll(async () => {
  container = await new RabbitMQContainer("rabbitmq:3.13-alpine").start();
  url = container.getAmqpUrl();
  process.env["LOG_LEVEL"] = "info"; // the handler's log line is part of the proof below
  process.env["CHARGE_LIMIT"] = "1000";
});

afterAll(async () => {
  await container.stop();
});

const until = async (predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition not reached in time");
};

describe("start-amqp-worker (full consume loop vs real RabbitMQ)", () => {
  it("consumes, settles (ack / dead-letter), and cancels subscriptions on shutdown", async () => {
    const log = vi.spyOn(console, "log");
    let driver: AmqpConnection | undefined;
    let publisher: amqplib.ChannelModel | undefined;

    try {
      driver = await createAmqpDriver(url);
      // The exact graph server.ts assembles.
      const boot = Layer.provideTo(bootstrap(PaymentsLive), ConfigLive);
      const graph = Layer.merge(
        boot,
        Layer.provideTo(runConsumer({ driver, queues: [CHARGE_QUEUE] }), boot),
      );

      publisher = await amqplib.connect(url);
      const channel = await publisher.createChannel();
      await channel.assertQueue(CHARGE_QUEUE, { durable: true });

      const messageCount = async (): Promise<number> =>
        (await channel.checkQueue(CHARGE_QUEUE)).messageCount;

      const outcome = await runHost(graph, {
        use: () =>
          fromSafePromise(
            (async () => {
              // 1. valid charge → the handler runs (log line) and the message is acked (drain)
              channel.sendToQueue(
                CHARGE_QUEUE,
                Buffer.from(JSON.stringify({ orderId: "o1", amount: 100 })),
                { messageId: "int-1", persistent: true },
              );
              await until(async () => (await messageCount()) === 0);
              await until(async () =>
                Promise.resolve(
                  log.mock.calls.some((args) => String(args[0]).includes("charging order o1")),
                ),
              );

              // 2. over the limit → PaymentDeclined → dead-letter (drained, NOT requeue-looping)
              channel.sendToQueue(
                CHARGE_QUEUE,
                Buffer.from(JSON.stringify({ orderId: "o2", amount: 99_999 })),
                { messageId: "int-2", persistent: true },
              );
              await until(async () => (await messageCount()) === 0);

              // 3. malformed body → ContractError → dead-letter (poison message, no loop)
              channel.sendToQueue(CHARGE_QUEUE, Buffer.from("not json at all"), {
                messageId: "int-3",
                persistent: true,
              });
              await until(async () => (await messageCount()) === 0);

              // stayed drained — nothing is circling back onto the queue
              await new Promise((resolve) => setTimeout(resolve, 300));
              expect(await messageCount()).toBe(0);
            })(),
          ),
      });

      outcome.match({
        ok: () => undefined,
        err: (error) => expect.unreachable(`consumer failed: ${error._tag}`),
        defect: (cause) => expect.unreachable(`panic: ${String(cause)}`),
      });

      // The scope has closed — the consumer must be cancelled: a new message stays READY.
      channel.sendToQueue(
        CHARGE_QUEUE,
        Buffer.from(JSON.stringify({ orderId: "o4", amount: 100 })),
        { messageId: "int-4", persistent: true },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await channel.checkQueue(CHARGE_QUEUE)).messageCount).toBe(1);
    } finally {
      log.mockRestore();
      await publisher?.close();
      await driver?.close();
    }
  });
});
