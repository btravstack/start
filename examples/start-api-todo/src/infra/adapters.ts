// Infrastructure — the concrete adapters. `LoggerLive` reads `Config` for the log level;
// `TodoRepoLive` is an in-memory store (the volatile adapter — a Prisma/Postgres one would swap in
// here via the same `bootstrap(repository)` seam, with every consumer unchanged).
import { Layer } from "demesne";
import { Err, Ok } from "unthrown";

import { Config } from "../config.js";
import { type Todo, TodoNotFound } from "../domain.js";
import { Logger, TodoRepository } from "../application/ports.js";

export const LoggerLive = Layer.inject(Logger, { config: Config }, ({ config }) => ({
  info: (msg) => {
    if (config.LOG_LEVEL !== "warn") console.log(`[todo] ${msg}`);
  },
}));

export const TodoRepoLive = Layer.factory(TodoRepository, () => {
  const store = new Map<string, Todo>();
  let seq = 0;
  return {
    create: (input) => {
      const id = String((seq += 1));
      const todo: Todo = { id, title: input.title, completed: false };
      store.set(id, todo);
      return Ok(todo).toAsync();
    },
    findById: (id) => {
      const todo = store.get(id);
      return todo !== undefined ? Ok(todo).toAsync() : Err(new TodoNotFound({ id })).toAsync();
    },
    list: () => Ok([...store.values()] as readonly Todo[]).toAsync(),
  };
});
