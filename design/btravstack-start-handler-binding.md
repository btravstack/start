# @btravstack/start — handler binding (draft)

> Companion to `btravstack-start.md` (RFC) and `btravstack-start-kernel-api.md` (API).
> Resolves the open gap flagged at the end of the API doc: **how does a contract bind to a
> use case that is constructor-injected?** Grounded in the three real use-case shapes in
> `examples/hono-prisma-api/src/application/`.

## The tension

demesne use cases come in three call conventions, all already wired as services in the graph:

| Use case                | Shape                                  | How it's called                | Error channel                     |
| ----------------------- | -------------------------------------- | ------------------------------ | --------------------------------- |
| `GetTodo` (`Service`)   | `class … { execute(id): AsyncResult }` | `ctx.get(GetTodo).execute(id)` | `TodoNotFound \| RepositoryError` |
| `CreateTodo` (`inject`) | `(input) => AsyncResult`               | `ctx.get(CreateTodo)(input)`   | `RepositoryError`                 |
| `ListTodos` (`inject`)  | `() => AsyncResult`                    | `ctx.get(ListTodos)()`         | `RepositoryError`                 |

A binding of the form `(useCase, input) => useCase.execute(input)` cannot cover all three
(different arities, `.execute` vs direct call). Worse, today's `routes.ts` handlers read
**more than the use case** off the request context —

```ts
// http/routes.ts:55-62 (get)
context.scope.get(RequestLogger).info(`todos.get ${input.id}`); // request-scoped service
return get
  .execute(input.id)
  .mapErr((error) =>
    error._tag === "@app/TodoNotFound" ? errors.NOT_FOUND() : errors.STORAGE_FAILED(),
  );
```

```ts
// http/routes.ts:70-76 (create) — also reads the AuditSinks collection
for (const sink of audit) sink.record({ action: "create", detail: todo.id });
```

So the handler genuinely needs the **fork context**, not just one injected use case. The
binding must give it that — and the domain→transport `mapErr` must move somewhere principled.

## Resolution — the handler is the transport edge, shaped like a `factory`

**A bound handler is `(input: In, ctx: Context<R>) => AsyncResult<Out, DomainErrors>`.** It
receives the validated contract input and the **fork context**, reads whatever services it
needs off `ctx` (the use case _plus_ request-scoped logger, audit sinks, …), and returns the
use case's **domain** error union — untranslated. This is exactly the `factory` shape
(ctx-in, no monad), which is why it sits naturally in demesne.

```ts
export function handler<In, Out, DomainErrors extends TaggedErrorMap, R>(
  contract: Contract<In, Out, DomainErrors>,
  handle: (input: In, ctx: Context<R>) => AsyncResult<Out, ErrorValue<DomainErrors>>,
): BoundHandler<R, In, Out, ErrorValue<DomainErrors>>;
```

Three things fall out of this shape, and each closes part of the tension:

1. **All three call conventions work**, because the handler author writes the call — the
   binding does not try to invoke the use case for them:

   ```ts
   handler(GetTodoContract, (input, ctx) => ctx.get(GetTodo).execute(input.id));
   handler(CreateTodoContract, (input, ctx) => ctx.get(CreateTodo)(input));
   handler(ListTodosContract, (_, ctx) => ctx.get(ListTodos)());
   ```

2. **Use cases stay constructor-injected.** The handler does not reimplement or re-inject
   them; it _dispatches_ to services the graph already built. `ctx.get` at the edge is
   idiomatic — it is what the oRPC procedures do today (`context.scope.get(...)`). The
   constructor-injection preference (`new UseCase(ports).execute(arg)`) is about how the use
   case is _built_, not how the edge _calls_ it.

3. **Requirements stay declared at boundaries (demesne invariant #2).** `R` is the handler's
   declared context type — the exact set of services it reads, app-scoped or request-scoped.
   The kernel's `invoke` must provide a `Context<R>`; if the handler reads a service the fork
   can't supply, it's a compile error. No inference from `ctx.get` calls.

## The error model, AS BUILT — the union rides on the HANDLER, not the contract

The API doc's §6 sketch put an `errors` record on the contract. The landed implementation
refines this further, and it is a better fit for the thesis: **the contract carries no error
set at all.** A `Contract<In, Out>` is purely the I/O boundary (two zod schemas, fully
inferred). The domain error union is **inferred from the handler's impl** — where the errors
are actually produced — and discharged at the mount's disposition map. Nothing is restated;
the union is declared exactly once, at its source.

The through-line is still one union, but its first position is the handler, not the contract:

```
handler's inferred E   ==   the union the disposition map must cover totally
   { TodoNotFound, RepositoryError }        (rides on the BoundHandler<R, In, Out, E>)
```

Why not on the contract? Because in this model the **client** sees the _transport_ codes
(produced by the disposition map), never the domain errors — so a contract listing domain
errors would be server-only noise the client can't use. The domain union is a purely
server-side concern: the handler produces it, the mount dispatches it. So:

```ts
const GetTodoContract = defineContract({
  input: z.object({ id: z.string() }),
  output: Todo, // ← no `errors`; the contract is just I/O
});

// E = TodoNotFound | RepositoryError is inferred HERE, from what the use case returns:
const getTodo = handler.use(GetTodoContract, GetTodo, (uc, input) => uc.execute(input.id));
```

and the `mapErr` that lived _inside_ the procedure moves **out** to the mount, where each
host maps the handler's inferred union to its own disposition (`DispositionMap<E, D>`, total
over `E`'s `_tag`s):

```ts
// api — domain error → oRPC client-visible code (this REPLACES routes.ts:59-61 mapErr)
api.route(
  getTodo,
  { method: "GET", path: "/todos/:id" },
  {
    "@app/TodoNotFound": () => api.error("NOT_FOUND"), // 404, typed end-to-end
    "@app/RepositoryError": () => api.error("STORAGE_FAILED"), // 500
  },
);

// amqp — the SAME inferred union, different dispositions
amqp.consumer(
  getTodo,
  { queue: "todos.get" },
  {
    "@app/TodoNotFound": (e) => amqp.deadLetter(e), // never going to succeed on retry
    "@app/RepositoryError": () => amqp.requeue(), // transient → nack + requeue
  },
);
```

(The disposition map keys on the runtime discriminant `_tag`, so the host dispatches with a
plain `dispatch(map, error)` lookup — no reverse record-key mapping.)

**Invariant B1 — no transport code in a contract or a handler.** A handler produces domain
errors; the host names the transport disposition. A status code, an ack decision, or a
Temporal retryability that appears inside a handler body is a bug — it belongs in the
disposition map. _(This is the split that lets one handler serve all three hosts unchanged.)_

**As-built note — the primitive `handler` annotates `ctx`.** Because demesne never infers
requirements from `ctx.get` usage (invariant #2), the primitive `handler(contract, (input,
ctx: Context<...>) => …)` requires the author to **annotate** `ctx` with the service set it
reads — that annotation _is_ the boundary declaration. `handler.use` needs no annotation: `R`
is the tag's identity. This is exactly the `factory` (annotated `ctx`) vs `class`/`inject`
(tag/record-derived) ergonomic split in demesne itself.

## The common case gets a sugar — `handler.use`

Most handlers dispatch to exactly one use case and translate nothing (translation is at the
mount now). For them the explicit `ctx.get` is boilerplate. A sugar removes it, mirroring how
demesne's `inject`/`class` remove the hand-written `ctx => new X(ctx.get(A))` factory
(parent invariant #7 — primitive + sugar family):

```ts
// points at one service tag; the invoker adapts the call convention
export function handlerUse<In, Out, DomainErrors, Svc>(
  contract: Contract<In, Out, DomainErrors>,
  tag: Tag<any, Svc>,
  invoke: (service: Svc, input: In) => AsyncResult<Out, ErrorValue<DomainErrors>>,
): BoundHandler<TagNeeds, In, Out, ErrorValue<DomainErrors>>;
```

```ts
handler.use(GetTodoContract, GetTodo, (uc, input) => uc.execute(input.id));
handler.use(CreateTodoContract, CreateTodo, (fn, input) => fn(input));
handler.use(ListTodosContract, ListTodos, (fn) => fn());
```

`handler.use` is `handler` with `ctx.get(tag)` pre-applied — `R = tag's identity`. Reach for
the primitive `handler` when the edge reads **more than one** service (the `create` case,
which also fans out to `AuditSinks`, or anything logging via `RequestLogger`). Do **not**
collapse the two: `handler.use` cannot express multi-service edges, and `handler` should not
guess which tag you meant. Same distinct-by-need discipline as the constructor family.

## Where request-scoped services fit

`RequestLogger` / `RequestId` (and the amqp equivalent, a message-scoped logger) are provided
by the fork's `requestLayer` (`http/request.ts` `RequestScopeLive`), not the app graph. So a
handler's `R` may include them, and the kernel's `invoke` merges parent + request layer before
resolving `ctx.get`:

```ts
// invoke = forkScope(parent, requestLayer, (forkCtx) => handle(input, forkCtx))
// forkCtx : Context<App | ProvidesOf<requestLayer>>   ⇒   R must be a subset of that
```

**Invariant B2 — a handler's `R` is bounded by `App | request-scope provisions`.** The mount
checks it: `api.route(h, …)` accepts `h` only if `NeedsOf<h> ⊆ App | ProvidesOf<RequestScopeLive>`.
Reading a service neither the app nor the request scope provides is a compile error at the
mount, not a runtime `ctx.get` miss. This is the transport-edge form of "everything discharged
before you run."

## This _is_ assisted injection

The parent spec calls out assisted injection (injected deps + call-time args) as already
solved: `new UseCase(ports).execute(arg)`. The handler binding is its transport face:

- **injected deps** — the use case is a service the graph built (ports constructor-injected);
- **call-time arg** — the contract's validated `input`, produced by zod at the edge;
- **the handler** — the one line that hands the second to the first.

No new mechanism. `defineContract` supplies the arg's schema and error set; the graph supplies
the injected use case; `handler` is the wire between them. That is the whole binding.

## Patch to the API doc

`btravstack-start-kernel-api.md` §6 should be read with two corrections from this doc:

1. `Contract.errors` is the **domain** error union, not transport codes (the doc's example
   reused a tag as both — wrong).
2. `defineHandler` is renamed `handler`, gains the `handler.use` sugar, and its `R` is bounded
   by B2. The disposition maps in that doc's §6 are correct as-is — they map the domain union,
   which is exactly what B1 requires.

## Invariants added by this doc

- **B1** — no transport code in a contract or handler; disposition maps own the translation.
- **B2** — a handler's `R` ⊆ `App | request-scope provisions`, checked at the mount.
- (**K5** unchanged) — every host mount demands a _total_ disposition map over the contract's
  domain error union; an unmapped arm is a compile error.
