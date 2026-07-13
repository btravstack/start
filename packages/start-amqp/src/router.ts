// The AMQP host's dispatch core: a builder that turns (contract + handler + disposition map)
// consumers into a `MessageRouter` service — a map from queue to a settle function that runs a
// message through the kernel's `runHandler` and decides its broker disposition. This is the amqp
// analog of start-api's `createHttpApp`; only the disposition type and the triage defaults differ.
// Pure transport glue — all DI / lifecycle / validation / dispatch logic lives in the kernel.
//
// Triage: Ok → ack; a kernel `ContractError` (malformed message) → dead-letter (permanent — a
// retry can't fix bad bytes); a domain error → the route's TOTAL map (transient⇒requeue vs
// permanent⇒deadLetter, decided per error); an unmapped tag or request-scope build error →
// requeue (assume transient); a defect (a thrown bug) → dead-letter (don't poison-loop the queue).

import {
  type BoundHandler,
  ContractError,
  dispatch,
  type DispositionMap,
  runHandler,
} from "@btravstack/start-kernel";
import { type Context, Layer, type Scope, Tag } from "demesne";

import { type AmqpDisposition, amqp } from "./disposition.js";

// A settle function for one queue: run a raw message body, decide its disposition. Total (never
// rejects) — every outcome, including a defect, maps to a disposition.
type QueueHandler = (body: unknown) => Promise<AmqpDisposition>;

export class MessageRouter extends Tag("@btravstack/start-amqp/MessageRouter")<
  MessageRouter,
  { readonly dispatch: (queue: string, body: unknown) => Promise<AmqpDisposition> }
>() {}

export type ConsumeSpec<Parent, ReqP, In, Out, E extends { readonly _tag: string }> = {
  readonly queue: string;
  readonly handler: BoundHandler<Parent | ReqP, In, Out, E>;
  readonly errors: DispositionMap<E, AmqpDisposition>;
};

export type ConsumerBuilder<Parent, ReqP, RErr> = {
  readonly consume: <In, Out, E extends { readonly _tag: string }>(
    spec: ConsumeSpec<Parent, ReqP, In, Out, E>,
  ) => ConsumerBuilder<Parent, ReqP, RErr>;
  readonly build: () => Layer<MessageRouter, never, Parent>;
};

type Registration<Parent> = {
  readonly queue: string;
  readonly register: (ctx: Context<Parent>, table: Map<string, QueueHandler>) => void;
};

// Development-only duplicate-registration warn — demesne's duplicate-Tag-id pattern: the
// NODE_ENV check sits inside the call with dot access on a locally-declared `process`, so
// bundler define-replacement folds the body out of a production build.
declare const process: undefined | { readonly env: { readonly NODE_ENV?: string } };
const warnDuplicateQueue = (queue: string): void => {
  if (typeof process === "undefined" || process.env.NODE_ENV === "production") return;
  console.warn(
    `@btravstack/start-amqp: duplicate consumer for queue ${JSON.stringify(queue)} — ` +
      `the later registration replaces the earlier one.`,
  );
};

// `createConsumer<AppServices>()(requestLayer)` — curried exactly like start-api's `createHttpApp`
// (Parent explicit, ReqP/RErr inferred), for the same reason: a trivial request layer can't pin
// Parent by inference. The builder is IMMUTABLE: each `consume` returns a new builder, so a shared
// base can be branched without the branches seeing each other's consumers.
export const createConsumer =
  <Parent>() =>
  <ReqP, RErr>(
    requestLayer: Layer<ReqP, RErr, Parent | Scope>,
  ): ConsumerBuilder<Parent, ReqP, RErr> => {
    const makeBuilder = (
      registrations: readonly Registration<Parent>[],
    ): ConsumerBuilder<Parent, ReqP, RErr> => ({
      consume: (spec) =>
        makeBuilder([
          ...registrations,
          {
            queue: spec.queue,
            register: (ctx, table) => {
              table.set(spec.queue, async (body) => {
                const result = await runHandler(ctx, requestLayer, spec.handler, body);
                return result.match({
                  ok: () => amqp.ack(),
                  err: (error) => {
                    if (error instanceof ContractError) {
                      return amqp.deadLetter(`invalid message: ${error.issues}`);
                    }
                    const tagged = error as { readonly _tag: string };
                    if (Object.hasOwn(spec.errors, tagged._tag)) {
                      // `E` isn't nameable in this non-generic method; widen to the erased map
                      // shape (membership already checked, so dispatch won't throw).
                      return dispatch(
                        spec.errors as unknown as DispositionMap<
                          { readonly _tag: string },
                          AmqpDisposition
                        >,
                        tagged,
                      );
                    }
                    return amqp.requeue();
                  },
                  // Carry the cause so operators can see WHAT dead-lettered, not just that
                  // something did.
                  defect: (cause) => amqp.deadLetter(`defect: ${String(cause)}`),
                });
              });
            },
          },
        ]),
      build: () =>
        Layer.factory(MessageRouter, (ctx: Context<Parent>) => {
          const table = new Map<string, QueueHandler>();
          for (const registration of registrations) {
            if (table.has(registration.queue)) warnDuplicateQueue(registration.queue);
            registration.register(ctx, table);
          }
          return {
            dispatch: (queue, body) => {
              const settle = table.get(queue);
              return settle !== undefined
                ? settle(body)
                : Promise.resolve(amqp.deadLetter(`no consumer for queue ${queue}`));
            },
          };
        }),
    });

    return makeBuilder([]);
  };
