// Contract — the zod-first, transport-neutral boundary (RFC §4). A contract is just the I/O
// shape: an input schema and an output schema. It is deliberately NOT where the error set lives
// — the domain error union rides on the *handler* (inferred from what its use case produces,
// invariant B1) and is discharged at the mount's disposition map. So a contract is fully inferred
// from its schemas, restates nothing, and carries no transport codes.
//
// The same contract is served over every host (api / amqp / temporal); only the binding (route /
// queue / activity) and the disposition map differ.

import { Err, Ok, type Result, TaggedError } from "unthrown";
import type { z } from "zod";

import { formatIssues } from "./internal/zod.js";

export type Contract<In, Out> = {
  readonly input: z.ZodType<In>;
  readonly output: z.ZodType<Out>;
};

// The kernel-owned failure when raw transport input does not match the contract's input schema.
// It is not a domain error — a host maps it with a fixed rule (400 / nack / non-retryable),
// distinct from the handler's domain disposition map.
export class ContractError extends TaggedError("@btravstack/start/ContractError", {
  name: "ContractError",
})<{
  readonly issues: string;
}> {}

export const defineContract = <IS extends z.ZodType, OS extends z.ZodType>(spec: {
  readonly input: IS;
  readonly output: OS;
  // The casts bridge zod's invariant `ZodType` output parameter (`IS`/`OS` erase to
  // `ZodType<unknown>` under the constraint) back to the inferred `z.infer<…>` — same output
  // type, just re-narrowed for the `Contract` shape.
}): Contract<z.infer<IS>, z.infer<OS>> => ({
  input: spec.input as z.ZodType<z.infer<IS>>,
  output: spec.output as z.ZodType<z.infer<OS>>,
});

// Validate raw transport input against the contract at the edge, once. A failure becomes a
// modeled `ContractError` (never a throw), mirroring `defineConfig`'s discipline.
export const parseInput = <In, Out>(
  contract: Contract<In, Out>,
  raw: unknown,
): Result<In, ContractError> => {
  const parsed = contract.input.safeParse(raw);
  if (parsed.success) return Ok(parsed.data);
  return Err(new ContractError({ issues: formatIssues(parsed.error) }));
};
