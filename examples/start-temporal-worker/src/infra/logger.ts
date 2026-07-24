import { Layer } from "demesne";

import { Logger } from "../application/ports.js";
import { Config } from "../config.js";

export const LoggerLive = Layer.inject(Logger, { config: Config }, ({ config }) => ({
  info: (msg) => {
    if (config.LOG_LEVEL !== "warn") console.log(`[charge-activity] ${msg}`);
  },
}));
