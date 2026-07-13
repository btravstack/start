// Domain — the Todo entity and the ways working with it can fail. Errors are unthrown
// `TaggedError`s; they are the DOMAIN error union a use case produces, mapped to HTTP status by
// the host's disposition map (never inside a handler).
import { TaggedError } from "unthrown";

export type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
};

export type NewTodo = { readonly title: string };

export class TodoNotFound extends TaggedError("@app/TodoNotFound", { name: "TodoNotFound" })<{
  readonly id: string;
}> {}

export class RepositoryError extends TaggedError("@app/RepositoryError", {
  name: "RepositoryError",
})<{
  readonly cause: unknown;
}> {}
