import { describe, expect, test } from "bun:test"

import { buildContextRows } from "./context"

describe("buildContextRows", () => {
  test("#given usage #when built #then the heading shows tokens against the window", () => {
    // given
    const usage = { tokens: 29_000, contextWindow: 1_000_000, percent: 2.9 }

    // when
    const rows = buildContextRows(usage, 40)

    // then
    expect(rows[0]?.text).toBe("CONTEXT  29K/1M")
  })

  test("#given usage #when built #then a bar row carries the percentage", () => {
    // given
    const usage = { tokens: 500_000, contextWindow: 1_000_000, percent: 50 }

    // when
    const rows = buildContextRows(usage, 40)

    // then
    expect(rows[1]?.text.startsWith("used    ")).toBe(true)
    expect(rows[1]?.text.endsWith(" 50%")).toBe(true)
    expect(rows[1]?.text).toContain("█")
  })

  test("#given tokens not measured yet #when built #then the row says so instead of showing zero", () => {
    // given
    const usage = { tokens: null, contextWindow: 1_000_000, percent: null }

    // when
    const rows = buildContextRows(usage, 40)

    // then
    expect(rows.map((row) => row.text)).toEqual(["CONTEXT", "window  measuring"])
  })

  test("#given a missing percent #when built #then it is derived from tokens and window", () => {
    // given
    const usage = { tokens: 250_000, contextWindow: 1_000_000, percent: null }

    // when
    const rows = buildContextRows(usage, 40)

    // then
    expect(rows[1]?.text.endsWith(" 25%")).toBe(true)
  })

  test("#given no usage at all #when built #then the section stays empty", () => {
    // given
    const usage = undefined

    // when
    const rows = buildContextRows(usage, 40)

    // then
    expect(rows).toEqual([])
  })
})
