// Domain — charging an order's payment. The two failures are the crux of the AMQP story: one is
// TRANSIENT (the gateway is briefly unavailable → the disposition map will requeue) and one is
// PERMANENT (the card was declined → dead-letter; a retry can't help).
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
