// A plain console logger — dependency-free, so it wires into every consumer without threading
// config through the graph. (Config is still factor-III central: DATABASE_URL feeds the Prisma
// adapter and PORT feeds the listener.)
import { Layer } from "demesne";

import { Logger } from "../application/ports.js";

export const LoggerLive = Layer.value(Logger, {
  info: (msg) => console.log(`[orpc-todo] ${msg}`),
});
