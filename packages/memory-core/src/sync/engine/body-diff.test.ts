import { describe, expect, test } from "bun:test"

import { bodyDiffFor, withHeard } from "./body-diff"

// PR #12295 review: the body line diff runs only when every other member of the account is known to
// run it; every unknown state keeps the character diff.

describe("bodyDiffFor", () => {
  const cases: readonly (readonly [
    string,
    readonly string[] | null,
    Parameters<typeof bodyDiffFor>[1],
    "line" | "char",
  ])[] = [
    ["membership unknown", null, { b: { seq: 4, bodyLine: true } }, "char"],
    ["a member never heard", ["b", "c"], { b: { seq: 4, bodyLine: true } }, "char"],
    ["a member heard without the capability", ["b"], { b: { seq: 4, bodyLine: false } }, "char"],
    [
      "every member heard with it",
      ["b", "c"],
      { b: { seq: 4, bodyLine: true }, c: { seq: 2, bodyLine: true } },
      "line",
    ],
    ["a one-device account", [], {}, "line"],
    [
      "a former member's record is irrelevant",
      ["b"],
      { b: { seq: 1, bodyLine: true }, gone: { seq: 3, bodyLine: false } },
      "line",
    ],
  ]
  for (const [name, others, heard, want] of cases) test(name, () => expect(bodyDiffFor(others, heard)).toBe(want))
})

describe("withHeard", () => {
  test("the latest batch wins, so a member that rolled back stops counting", () => {
    const capable = withHeard({}, 5, { author: "b", bodyLine: true })
    expect(bodyDiffFor(["b"], capable)).toBe("line")
    expect(bodyDiffFor(["b"], withHeard(capable, 9, { author: "b", bodyLine: false }))).toBe("char")
  })

  test("an older or repeated batch never overrides a newer one", () => {
    const rolledBack = withHeard({}, 9, { author: "b", bodyLine: false })
    expect(withHeard(rolledBack, 5, { author: "b", bodyLine: true })).toBe(rolledBack)
    expect(withHeard(rolledBack, 9, { author: "b", bodyLine: true })).toBe(rolledBack)
  })
})
