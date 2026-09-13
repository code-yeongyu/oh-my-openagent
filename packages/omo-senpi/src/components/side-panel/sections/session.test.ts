import { describe, expect, test } from "bun:test"

import { buildSessionRows, type PanelSessionTotals } from "./session"

const totals = (overrides: Partial<PanelSessionTotals> = {}): PanelSessionTotals => ({
  input: 12_300,
  output: 4_500,
  cacheRead: 900,
  cacheWrite: 100,
  cost: 1.2,
  ...overrides,
})

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildSessionRows", () => {
  test("#given totals and child spend #when built #then the heading carries one combined total", () => {
    // given
    const facts = { now: 1_000, childSpend: 0.3, totals: totals() }

    // when
    const rows = buildSessionRows(facts, 40)

    // then
    expect(rows[0]?.text).toBe("SESSION  $1.50 · 16.8K")
  })

  test("#given a session that knows nothing yet #when built #then the block stays silent", () => {
    // given
    const facts = { now: 1_000, childSpend: 0 }

    // when
    const rows = buildSessionRows(facts, 40)

    // then
    expect(rows).toEqual([])
  })

  test("#given only a start time #when built #then the heading appears without a total", () => {
    // given
    const facts = { now: 1_000, startedAt: 0, childSpend: 0 }

    // when
    const rows = buildSessionRows(facts, 40)

    // then
    expect(rows[0]?.text).toBe("SESSION")
    expect(rows[1]?.text).toBe("elapsed 1s")
  })

  test("#given a model and a start time #when built #then model and elapsed rows are present", () => {
    // given
    const facts = { now: 300_000, startedAt: 30_000, model: "claude-opus-5", childSpend: 0 }

    // when
    const rows = texts(buildSessionRows(facts, 40))

    // then
    expect(rows).toContain("model   claude-opus-5")
    expect(rows).toContain("elapsed 4m30")
  })

  test("#given a host cache hit rate #when built #then the percentage is not scaled again", () => {
    // given the host already stores a percentage, so a second x100 would print 9230% hit
    const facts = { now: 1_000, childSpend: 0, totals: totals({ latestCacheHitRate: 92.3 }) }

    // when
    const rows = texts(buildSessionRows(facts, 40))

    // then
    expect(rows).toContain("cache   92% hit")
  })

  test("#given no child spend #when built #then no agents row appears", () => {
    // given
    const facts = { now: 1_000, childSpend: 0, totals: totals() }

    // when
    const rows = texts(buildSessionRows(facts, 40))

    // then
    expect(rows.some((row) => row.startsWith("agents"))).toBe(false)
  })

  test("#given child spend #when built #then it is called out on its own row", () => {
    // given
    const facts = { now: 1_000, childSpend: 0.42, totals: totals() }

    // when
    const rows = texts(buildSessionRows(facts, 40))

    // then
    expect(rows).toContain("agents  $0.42")
  })

  test("#given no width #when built #then nothing is rendered", () => {
    // given
    const facts = { now: 1_000, childSpend: 1 }

    // when
    const rows = buildSessionRows(facts, 0)

    // then
    expect(rows).toEqual([])
  })

  test("#given a started session that has not spent anything #when built #then no zero total and no zero token row", () => {
    // given
    const facts = {
      now: 5_000,
      startedAt: 0,
      model: "mock-1",
      childSpend: 0,
      totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    }

    // when
    const rows = texts(buildSessionRows(facts, 40))

    // then
    expect(rows[0]).toBe("SESSION")
    expect(rows.some((row) => row.startsWith("tokens"))).toBe(false)
  })
})
