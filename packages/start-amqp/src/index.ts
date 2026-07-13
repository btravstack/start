// @btravstack/start-amqp — the AMQP host for btravstack start. Consume demesne-wired contracts,
// one message per fork scope, deciding ack / requeue / dead-letter with a total disposition map,
// and deduping redelivery by message id. Pure transport glue over @btravstack/start-kernel:
//   • createConsumer — a builder turning (contract + handler + disposition map) consumers into a
//     MessageRouter service (queue → settle decision)
//   • runConsumer    — the consume loop as an `acquireRelease` resource over a wire `AmqpDriver`,
//     with optional idempotent redelivery; torn down on shutdown
//   • amqp.ack / requeue / deadLetter — build a settlement disposition for a domain error
//
// The broker wire protocol (amqplib) is injected via the `AmqpDriver` interface, not bundled.

export { type AmqpDisposition, amqp } from "./disposition.js";
export {
  type AmqpDelivery,
  type AmqpDriver,
  type AmqpSubscription,
  ConsumeError,
  Consumer,
  type IdempotencyStore,
  runConsumer,
} from "./driver.js";
export { type ConsumeSpec, type ConsumerBuilder, createConsumer, MessageRouter } from "./router.js";
