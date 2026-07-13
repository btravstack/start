import { TaggedError } from "unthrown";

export type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: Date;
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
