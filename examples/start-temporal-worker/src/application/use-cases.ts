import { Layer, Tag } from "demesne";
import type { AsyncResult } from "unthrown";

import type { ChargeCommand, PaymentDeclined, PaymentUnavailable, Receipt } from "../domain.js";
import { Logger, Payments } from "./ports.js";

export class ChargeOrder extends Tag("@app/ChargeOrder")<
  ChargeOrder,
  (command: ChargeCommand) => AsyncResult<Receipt, PaymentUnavailable | PaymentDeclined>
>() {}

export const ChargeOrderLive = Layer.inject(
  ChargeOrder,
  { logger: Logger, payments: Payments },
  ({ logger, payments }) =>
    (command) => {
      logger.info(`charging order ${command.orderId} (${command.amount})`);
      return payments.charge(command);
    },
);
