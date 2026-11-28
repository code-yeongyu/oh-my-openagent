import { describe, expect, test } from "bun:test"

import { compare, compareValues, flakeMaskingSites } from "./lint-ratchet.ts"

const CASE = (timeout: string): string => `
const BUDGET = 5_000
describe("widget", () => {
  test("slow scan", () => {}, ${timeout})
})
`

const sites = (source: string): readonly (number | null)[] => flakeMaskingSites("a.test.ts", source).map((s) => s.value)

describe("no-flake-masking value ratchet (#15114)", () => {
  test("#given an existing 60_000 raised to 216_000 #when compared #then the raise is reported with the old and new values", () => {
    const base = flakeMaskingSites("a.test.ts", CASE("60_000"))
    const raised = flakeMaskingSites("a.test.ts", CASE("216_000"))
    expect(compareValues({ "a.test.ts": base }, { "a.test.ts": raised })).toEqual([
      { file: "a.test.ts", before: 60_000, after: 216_000, line: raised[0]?.line },
    ])
  })

  test("#given the same value lowered #when compared #then it passes", () => {
    const raises = compareValues(
      { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("60_000")) },
      { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("30_000")) },
    )
    expect(raises).toEqual([])
  })

  test("#given an unchanged value #when compared #then it passes", () => {
    const raises = compareValues(
      { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("60_000")) },
      { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("60_000")) },
    )
    expect(raises).toEqual([])
  })

  test("#given a case moved within the file with its value unchanged #when compared #then it passes", () => {
    const before = `${CASE("60_000")}\ntest("other", () => {})`
    const after = `test("other", () => {})\n${CASE("60_000")}`
    const raises = compareValues(
      { "a.test.ts": flakeMaskingSites("a.test.ts", before) },
      { "a.test.ts": flakeMaskingSites("a.test.ts", after) },
    )
    expect(raises).toEqual([])
  })

  test("#given a numeric separator, a same-file constant and an arithmetic form #when extracted #then each resolves to its value", () => {
    expect(sites(CASE("60_000"))).toEqual([60_000])
    expect(sites(CASE("BUDGET"))).toEqual([5_000])
    expect(sites(CASE("BUDGET + 60_000"))).toEqual([65_000])
  })

  test("an unresolved value fails even when the baseline has the same number of unresolved values", () => {
    const entries = flakeMaskingSites("a.test.ts", CASE("readBudget()"))
    expect(entries[0]?.value).toBeNull()
    expect(compareValues({ "a.test.ts": entries }, { "a.test.ts": entries })[0]?.unresolvable).toBe(true)
  })

  test("#given a new argument added #when the count ratchet compares #then it fails as today (control: counts alone miss a raise)", () => {
    const baseCounts = { "a.test.ts": { "omo-testing/no-flake-masking": 1 } }
    const raisedCounts = { "a.test.ts": { "omo-testing/no-flake-masking": 1 } }
    // The control from the acceptance: with the value comparison removed, the raised timeout passes
    // the count ratchet - counts are identical, so compare() reports nothing.
    expect(compare(baseCounts, raisedCounts).increases).toEqual([])
    expect(
      compareValues(
        { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("60_000")) },
        { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("216_000")) },
      ),
    ).not.toEqual([])
    // A new finding still fails through the count rule.
    expect(compare(baseCounts, { "a.test.ts": { "omo-testing/no-flake-masking": 2 } }).increases).toEqual([
      { file: "a.test.ts", rule: "omo-testing/no-flake-masking", before: 1, after: 2 },
    ])
  })

  test("#given a config-object timeout or a retry property #when extracted #then its value is tracked too", () => {
    const config = `vi.setConfig({ testTimeout: 60_000 })\n`
    expect(flakeMaskingSites("a.test.ts", config).map((s) => s.value)).toEqual([60_000])
    const retry = `const suite = { test: { retry: 3 } }\n`
    expect(flakeMaskingSites("a.test.ts", retry).map((s) => s.value)).toEqual([3])
  })
})

test("a raise in one named case is still a raise when another case lowers its budget", () => {
  const source = (a: number, b: number) => `test("a", () => {}, ${a}); test("b", () => {}, ${b})`
  const base = flakeMaskingSites("a.test.ts", source(100, 200))
  const current = flakeMaskingSites("a.test.ts", source(200, 100))
  expect(compareValues({ "a.test.ts": base }, { "a.test.ts": current })).toContainEqual({
    file: "a.test.ts",
    line: 1,
    before: 100,
    after: 200,
  })
})

test("a dynamic budget fails even when two expressions are equally unresolved", () => {
  const source = (arg: string) => flakeMaskingSites("a.test.ts", `test("a", () => {}, ${arg})`)
  const raises = compareValues({ "a.test.ts": source("one()") }, { "a.test.ts": source("two()") })
  expect(raises[0]?.unresolvable).toBe(true)
})

test("per-platform values detect either branch rising while the other stays steady", () => {
  const values = (posix: number, win: number) =>
    flakeMaskingSites("a.test.ts", CASE(`process.platform === "win32" ? ${win} : ${posix}`))
  const base = { "a.test.ts": values(5000, 15000) }
  expect(compareValues(base, { "a.test.ts": values(6000, 15000) })[0]).toMatchObject({ before: 5000, after: 6000 })
  expect(compareValues(base, { "a.test.ts": values(5000, 16000) })[0]).toMatchObject({ before: 15000, after: 16000 })
})

test("constants respect lexical scope and mutable variables are unresolved", () => {
  const source = `const T = 200; describe("outer", () => { const T = 100; test("inner", () => {}, T) }); test("outer", () => {}, T)`
  expect(sites(source)).toEqual([100, 200])
  expect(sites("let T = 100; T *= 5; test('changed', () => {}, T)")).toEqual([null])
})

test("local functions and fixture objects that share test API names have no budget", () => {
  const source = `function describe(name: string, label: string, now: number) {return label}; describe("a", "b", clock());
    const test = { pi: { dispatch: (...args: unknown[]) => args } }; test.pi.dispatch("event", {}, context())`
  expect(sites(source)).toEqual([])
})
