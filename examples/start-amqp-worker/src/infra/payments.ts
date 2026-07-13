// A demo Payments adapter: approves a charge unless it exceeds the configured limit (then the card
// is "declined" — a permanent failure). A real adapter would call Stripe/Adyen and translate their
// transient errors to `PaymentUnavailable` and business rejections to `PaymentDeclined`. Swappable
// via the `bootstrap(payments)` seam — a test passes a fake with scripted failures.
import { Layer } from "demesne";
import { Err, Ok } from "unthrown";

import { Config } from "../config.js";
import { PaymentDeclined } from "../domain.js";
import { Payments } from "../application/ports.js";

let counter = 0;

export const PaymentsLive = Layer.inject(Payments, { config: Config }, ({ config }) => ({
  charge: (command) => {
    if (command.amount > config.CHARGE_LIMIT) {
      return Err(new PaymentDeclined({ reason: "over limit" })).toAsync();
    }
    counter += 1;
    return Ok({ receiptId: `rcpt_${counter}` }).toAsync();
  },
}));
