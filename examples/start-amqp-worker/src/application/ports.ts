import { Tag } from "demesne";
import type { AsyncResult } from "unthrown";

import type { ChargeCommand, PaymentDeclined, PaymentUnavailable, Receipt } from "../domain.js";

export class Logger extends Tag("@app/Logger")<
  Logger,
  { readonly info: (msg: string) => void }
>() {}

export class Payments extends Tag("@app/Payments")<
  Payments,
  {
    readonly charge: (
      command: ChargeCommand,
    ) => AsyncResult<Receipt, PaymentUnavailable | PaymentDeclined>;
  }
>() {}
