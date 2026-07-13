// A REAL amqplib implementation of start-amqp's `AmqpDriver` seam. It connects, asserts the queue,
// and for each delivery runs the host's settle callback and applies the returned disposition to the
// broker: ack, nack+requeue, or nack-without-requeue (which routes to the queue's dead-letter
// exchange when configured). This is the only broker-specific code in the app; everything else is
// transport-neutral. (Not exercised by the tests — they use a fake driver — but it compiles against
// the real amqplib types and is what `server.ts` runs.)
import type {
  AmqpDelivery,
  AmqpDisposition,
  AmqpDriver,
  AmqpSubscription,
} from "@btravstack/start-amqp";
import * as amqp from "amqplib";

export type AmqpConnection = AmqpDriver & { readonly close: () => Promise<void> };

const parseBody = (content: Buffer): unknown => {
  try {
    return JSON.parse(content.toString("utf8"));
  } catch {
    return {};
  }
};

export const createAmqpDriver = async (url: string): Promise<AmqpConnection> => {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();

  const consume = async (
    queue: string,
    onDelivery: (delivery: AmqpDelivery) => Promise<AmqpDisposition>,
  ): Promise<AmqpSubscription> => {
    await channel.assertQueue(queue, { durable: true });

    const handle = async (message: amqp.ConsumeMessage): Promise<void> => {
      // `messageId` is optional under exactOptionalPropertyTypes — include the key only when set.
      const messageId = message.properties.messageId as string | undefined;
      const delivery: AmqpDelivery = {
        queue,
        body: parseBody(message.content),
        ...(messageId !== undefined ? { messageId } : {}),
      };
      const disposition = await onDelivery(delivery);
      if (disposition.kind === "ack") channel.ack(message);
      else channel.nack(message, false, disposition.kind === "requeue");
    };

    const { consumerTag } = await channel.consume(queue, (message) => {
      if (message !== null) void handle(message);
    });

    return {
      cancel: async () => {
        await channel.cancel(consumerTag);
      },
    };
  };

  return {
    consume,
    close: async () => {
      await channel.close();
      await connection.close();
    },
  };
};
