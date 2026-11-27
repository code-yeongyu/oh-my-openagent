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

  test("#given a value from an imported or dynamic expression #when extracted #then it is unresolvable and pinned by count", () => {
    const source = `import { BUDGET } from "./budget"\ntest("slow", () => {}, BUDGET)\n`
    expect(sites(source)).toEqual([null])
    const raises = compareValues(
      { "a.test.ts": flakeMaskingSites("a.test.ts", source) },
      { "a.test.ts": flakeMaskingSites("a.test.ts", source) },
    )
    expect(raises).toEqual([])
    // One more unresolvable site than the baseline holds: fail, even though the count rule alone
    // would also see it. One fewer (a literal became an import): fail too - the raise could hide there.
    const second = `${source}test("other", () => {}, BUDGET)\n`
    expect(compareValues({ "a.test.ts": flakeMaskingSites("a.test.ts", source) }, { "a.test.ts": flakeMaskingSites("a.test.ts", second) })).toEqual([
      { file: "a.test.ts", before: 0, after: 0, line: expect.any(Number), unresolvable: true },
    ])
    // A resolvable value that becomes unresolvable is the same dead angle: the null count changes.
    const becameImport = `import { BUDGET } from "./budget"\ntest("slow", () => {}, BUDGET)\ntest("other", () => {}, BUDGET)\n`
    expect(
      compareValues(
        { "a.test.ts": flakeMaskingSites("a.test.ts", `test("slow", () => {}, BUDGET)\ntest("other", () => {}, 60_000)\n`) },
        { "a.test.ts": flakeMaskingSites("a.test.ts", becameImport) },
      ).at(0)?.unresolvable,
    ).toBe(true)
  })

  test("#given a new argument added #when the count ratchet compares #then it fails as today (control: counts alone miss a raise)", () => {
    const baseCounts = { "a.test.ts": { "omo-testing/no-flake-masking": 1 } }
    const raisedCounts = { "a.test.ts": { "omo-testing/no-flake-masking": 1 } }
    // The control from the acceptance: with the value comparison removed, the raised timeout passes
    // the count ratchet - counts are identical, so compare() reports nothing.
    expect(compare(baseCounts, raisedCounts).increases).toEqual([])
    expect(compareValues({ "a.test.ts": flakeMaskingSites("a.test.ts", CASE("60_000")) }, { "a.test.ts": flakeMaskingSites("a.test.ts", CASE("216_000")) })).not.toEqual([])
    // A new finding still fails through the count rule.
    expect(
      compare(baseCounts, { "a.test.ts": { "omo-testing/no-flake-masking": 2 } }).increases,
    ).toEqual([{ file: "a.test.ts", rule: "omo-testing/no-flake-masking", before: 1, after: 2 }])
  })

  test("#given a config-object timeout or a retry property #when extracted #then its value is tracked too", () => {
    const config = `vi.setConfig({ testTimeout: 60_000 })\n`
    expect(flakeMaskingSites("a.test.ts", config).map((s) => s.value)).toEqual([60_000])
    const retry = `const suite = { test: { retry: 3 } }\n`
    expect(flakeMaskingSites("a.test.ts", retry).map((s) => s.value)).toEqual([3])
  })
})
