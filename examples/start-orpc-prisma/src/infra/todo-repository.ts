// The TodoRepository port backed by Prisma, through the `@unthrown/prisma` bridge: each query is a
// `try*` method returning an `AsyncResult` whose error channel is the P-codes it can hit.
// `findById` maps `RecordNotFound` (P2025) to the domain `TodoNotFound`; everything else folds into
// `RepositoryError`. Swappable via `bootstrap(repository)`.
import { type Context, Layer } from "demesne";

import { TodoRepository } from "../application/ports.js";
import { RepositoryError, TodoNotFound } from "../domain.js";
import { Database } from "./prisma.js";

export const TodoRepoLive = Layer.factory(TodoRepository, (ctx: Context<Database>) => {
  const db = ctx.get(Database);
  const toRepositoryError = (cause: unknown): RepositoryError => new RepositoryError({ cause });

  return {
    list: () => db.todo.tryFindMany({ orderBy: { createdAt: "desc" } }).mapErr(toRepositoryError),

    findById: (id) =>
      db.todo
        .tryFindUniqueOrThrow({ where: { id } })
        .mapErr((error) =>
          error._tag === "RecordNotFound"
            ? new TodoNotFound({ id })
            : new RepositoryError({ cause: error }),
        ),

    create: (input) =>
      db.todo.tryCreate({ data: { title: input.title } }).mapErr(toRepositoryError),
  };
});
