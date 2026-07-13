// Ports — the boundaries the application depends on, declared as demesne tags (invariant #2:
// requirements are declared, not inferred). The infra layer provides concrete adapters; a test
// can provide fakes. The class IS the tag, with the service shape inlined.
import { Tag } from "demesne";
import type { AsyncResult } from "unthrown";

import type { NewTodo, RepositoryError, Todo, TodoNotFound } from "../domain.js";

export class Logger extends Tag("@app/Logger")<
  Logger,
  { readonly info: (msg: string) => void }
>() {}

export class TodoRepository extends Tag("@app/TodoRepository")<
  TodoRepository,
  {
    readonly create: (todo: NewTodo) => AsyncResult<Todo, RepositoryError>;
    readonly findById: (id: string) => AsyncResult<Todo, TodoNotFound | RepositoryError>;
    readonly list: () => AsyncResult<readonly Todo[], RepositoryError>;
  }
>() {}
