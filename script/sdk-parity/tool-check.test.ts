import { describe, expect, test } from "bun:test"

import { schemaDifferences } from "./tool-check"

describe("schemaDifferences set-narrowing keywords (#15178)", () => {
  // One negative control per keyword the gate gained: a tool/base change must be reported.
  const CHANGED_KEYWORDS: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["exclusiveMinimum", 0, 1],
    ["exclusiveMaximum", 100, 99],
    ["multipleOf", 1000, 500],
    ["oneOf", [{ type: "string" }], [{ type: "string" }, { type: "number" }]],
    ["allOf", [{ required: ["a"] }], []],
    ["if", { required: ["a"] }, { required: ["b"] }],
    ["then", { required: ["a"] }, {}],
    ["else", { required: ["b"] }, {}],
    ["not", { required: ["a", "b"] }, { required: ["a"] }],
    ["minProperties", 1, 2],
    ["maxProperties", 5, 4],
    ["dependentRequired", { a: ["b"] }, {}],
    ["dependentSchemas", { a: { required: ["b"] } }, {}],
  ]

  for (const [keyword, base, head] of CHANGED_KEYWORDS) {
    test(`#given a tool whose ${keyword} narrowed #when compared with the SDK #then the change is reported`, () => {
      const differences = schemaDifferences({ type: "object", [keyword]: head }, { type: "object", [keyword]: base }, "field")
      expect(differences.some((line) => line.includes(`${keyword} is`))).toBe(true)
    })
  }

  test("#given matching schemas with every narrowing keyword #when compared #then no difference is reported", () => {
    const schema = {
      type: "object",
      exclusiveMinimum: 0,
      exclusiveMaximum: 100,
      multipleOf: 2,
      oneOf: [{ type: "string" }],
      allOf: [{ required: ["a"] }],
      if: { required: ["a"] },
      then: { required: ["b"] },
      else: { required: ["c"] },
      not: { required: ["d"] },
      minProperties: 1,
      maxProperties: 5,
      dependentRequired: { a: ["b"] },
      dependentSchemas: { a: { required: ["b"] } },
      properties: { a: { type: "string" } },
      required: ["a"],
    }
    expect(schemaDifferences(schema, structuredClone(schema), "field")).toEqual([])
  })

  test("#given a keyword the gate does not model #when compared #then it is refused, not ignored (#15178)", () => {
    const differences = schemaDifferences(
      { type: "string", contentEncoding: "base64" },
      { type: "string", contentEncoding: "utf8" },
      "field",
    )
    expect(differences).toEqual([
      expect.stringContaining("keyword contentEncoding is not modeled by the parity gate"),
    ])
  })

  test("#given a keyword present on only one side #when compared #then it is refused", () => {
    const differences = schemaDifferences({ type: "string" }, { type: "string", contentMediaType: "text/html" }, "field")
    expect(differences).toEqual([expect.stringContaining("keyword contentMediaType is not modeled")])
  })
})
