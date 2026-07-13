import "@unthrown/vitest";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineContract, parseInput } from "./contract.js";

const CreateTodo = defineContract({
  input: z.object({ title: z.string().min(1) }),
  output: z.object({ id: z.string(), title: z.string() }),
});

describe("defineContract / parseInput", () => {
  it("accepts valid input and returns the parsed value", () => {
    expect(parseInput(CreateTodo, { title: "buy milk" })).toBeOkWith({ title: "buy milk" });
  });

  it("rejects invalid input with a ContractError naming the field", () => {
    expect(parseInput(CreateTodo, { title: "" })).toBeErrWith(
      expect.objectContaining({
        _tag: "@btravstack/start/ContractError",
        issues: expect.stringContaining("title"),
      }),
    );
  });
});
