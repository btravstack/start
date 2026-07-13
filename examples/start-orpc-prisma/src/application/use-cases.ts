import { Layer, Service, Tag } from "demesne";
import type { AsyncResult } from "unthrown";

import type { NewTodo, RepositoryError, Todo, TodoNotFound } from "../domain.js";
import { Logger, TodoRepository } from "./ports.js";

export class GetTodo extends Service<GetTodo>()("@app/GetTodo", {
  logger: Logger,
  todos: TodoRepository,
}) {
  execute(id: string): AsyncResult<Todo, TodoNotFound | RepositoryError> {
    this.logger.info(`getting todo ${id}`);
    return this.todos.findById(id);
  }
}
export const GetTodoLive = Layer.fromService(GetTodo);

export class CreateTodo extends Tag("@app/CreateTodo")<
  CreateTodo,
  (input: NewTodo) => AsyncResult<Todo, RepositoryError>
>() {}
export const CreateTodoLive = Layer.inject(
  CreateTodo,
  { logger: Logger, todos: TodoRepository },
  ({ logger, todos }) =>
    (input) => {
      logger.info(`creating todo "${input.title}"`);
      return todos.create(input);
    },
);

export class ListTodos extends Tag("@app/ListTodos")<
  ListTodos,
  () => AsyncResult<readonly Todo[], RepositoryError>
>() {}
export const ListTodosLive = Layer.inject(
  ListTodos,
  { logger: Logger, todos: TodoRepository },
  ({ logger, todos }) =>
    () => {
      logger.info("listing todos");
      return todos.list();
    },
);
