// The same charge domain as the AMQP example — the point being that one domain runs unchanged
// over different transports. Here `PaymentUnavailable` is transient (Temporal should retry the
// activity) and `PaymentDeclined` is permanent (fail the activity, no retry).
import { TaggedError } from "unthrown";

export type ChargeCommand = { readonly orderId: string; readonly amount: number };
export type Receipt = { readonly receiptId: string };

export class PaymentUnavailable extends TaggedError("@app/PaymentUnavailable", {
  name: "PaymentUnavailable",
})<{
  readonly cause: string;
}> {}

export class PaymentDeclined extends TaggedError("@app/PaymentDeclined", {
  name: "PaymentDeclined",
})<{
  readonly reason: string;
}> {}
