// Demo Payments adapter — approves unless over the configured limit (then declined, permanent).
// Swappable via the `bootstrap(payments)` seam; a test passes a fake with scripted failures.
import { Layer } from "demesne";
import { Err, Ok } from "unthrown";

import { Payments } from "../application/ports.js";
import { Config } from "../config.js";
import { PaymentDeclined } from "../domain.js";

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
