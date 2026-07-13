import { Layer } from "demesne";

import { Config } from "../config.js";
import { Logger } from "../application/ports.js";

export const LoggerLive = Layer.inject(Logger, { config: Config }, ({ config }) => ({
  info: (msg) => {
    if (config.LOG_LEVEL !== "warn") console.log(`[charge-activity] ${msg}`);
  },
}));
