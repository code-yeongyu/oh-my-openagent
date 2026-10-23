import { expect, test } from "bun:test"
import { Type } from "typebox"
import { Value } from "typebox/value"

import { argumentFailure, schemaProblem } from "./session-args-schema"

// Contract: the worker's own check replaced typebox's Value.Check for declared op arguments, so the
// subset must keep the verdicts a typebox-declared schema had, and must refuse what it cannot check.
const declared = Type.Object({
  target: Type.String({ minLength: 1, maxLength: 3, pattern: "^[a-z]+$" }),
  mode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("manual")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
  ratio: Type.Optional(Type.Number({ exclusiveMaximum: 1 })),
  tags: Type.Optional(Type.Array(Type.String(), { maxItems: 2 })),
  flag: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

test("#given an argument schema written with typebox #when the store checks it #then it is inside the subset", () => {
  expect(schemaProblem(declared)).toBeUndefined()
})

test.each<[string, unknown, boolean]>([
  ["the smallest valid object", { target: "ab" }, true],
  ["every optional field set", { target: "abc", mode: "manual", limit: 10, ratio: 0.5, tags: ["x", "y"], flag: false }, true],
  ["a missing required field", {}, false],
  ["an undeclared field", { target: "ab", extra: 1 }, false],
  ["a string past maxLength", { target: "abcd" }, false],
  ["a string that breaks the pattern", { target: "AB" }, false],
  ["a literal outside the union", { target: "ab", mode: "off" }, false],
  ["a fractional integer", { target: "ab", limit: 1.5 }, false],
  ["a number at its exclusive maximum", { target: "ab", ratio: 1 }, false],
  ["a NaN number", { target: "ab", ratio: Number.NaN }, false],
  ["an array past maxItems", { target: "ab", tags: ["x", "y", "z"] }, false],
  ["an array item of the wrong type", { target: "ab", tags: [1] }, false],
  ["a boolean given as a string", { target: "ab", flag: "true" }, false],
  ["an array instead of the object", [], false],
])("#given %s #when checked #then it is accepted only when typebox would accept it", (_label, value, accepted) => {
  expect(Value.Check(declared, value)).toBe(accepted)
  expect(argumentFailure(declared as unknown as Readonly<Record<string, unknown>>, value) === undefined).toBe(accepted)
})

test.each<[string, unknown]>([
  ["a format keyword", { type: "object", properties: { at: { type: "string", format: "date-time" } } }],
  ["a nested $ref", { type: "object", properties: { at: { $ref: "#/x" } } }],
  ["an additionalProperties schema", { type: "object", additionalProperties: { type: "string" } }],
  ["an unknown type name", { type: "object", properties: { at: { type: "text" } } }],
])("#given a schema with %s #when the store checks it #then it is outside the subset", (_label, schema) => {
  expect(schemaProblem(schema)).toBeString()
})
