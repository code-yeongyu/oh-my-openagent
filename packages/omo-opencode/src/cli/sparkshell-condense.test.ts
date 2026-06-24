import { describe, expect, test } from "bun:test"

import { condenseOutput, extractContextHints } from "./sparkshell-condense"

function buildLog(lineCount: number, lineFor: (index: number) => string): string {
  return `${Array.from({ length: lineCount }, (_, index) => lineFor(index)).join("\n")}\n`
}

describe("sparkshell condense", () => {
  test("#given output within budget #when condensing #then returns the text byte-identical", () => {
    // given
    const text = "line-1\nline-2\nline-3\n"

    // when
    const result = condenseOutput(text, { budgetChars: 20_000, hints: [] })

    // then
    expect(result.condensed).toBe(false)
    expect(result.output).toBe(text)
  })

  test("#given oversized output #when condensing #then fits the budget and keeps head, tail, and error signatures", () => {
    // given
    const text = buildLog(5000, (index) => {
      if (index === 2500) return "ERROR: connection refused to db-primary:5432"
      if (index === 3000) return "panic: runtime error: index out of range"
      return `2026-06-10T12:00:00Z info request ${index} served in 12ms`
    })

    // when
    const result = condenseOutput(text, { budgetChars: 8000, hints: [] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output.length).toBeLessThanOrEqual(8000)
    expect(result.output).toContain("[sparkshell] condensed:")
    expect(result.output).toContain("info request 0 served")
    expect(result.output).toContain("info request 4999 served")
    expect(result.output).toContain("ERROR: connection refused to db-primary:5432")
    expect(result.output).toContain("panic: runtime error: index out of range")
    expect(result.output).toContain("lines omitted")
  })

  test("#given session hints #when condensing #then preserves lines matching the session goal tokens", () => {
    // given
    const text = buildLog(4000, (index) => {
      if (index === 2000) return "applying migration fable-fallback.ts step 3"
      return `worker ${index} idle`
    })

    // when
    const result = condenseOutput(text, { budgetChars: 6000, hints: ["fable-fallback.ts"] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output).toContain("applying migration fable-fallback.ts step 3")
  })

  test("#given consecutive duplicate lines #when condensing #then collapses them with a repeat count", () => {
    // given
    const text = buildLog(3000, (index) => (index >= 100 && index < 2900 ? "retrying connection..." : `unique line ${index}`))

    // when
    const result = condenseOutput(text, { budgetChars: 5000, hints: [] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output).toContain("retrying connection... [x2800]")
    expect(result.output.match(/retrying connection\.\.\./g)?.length).toBe(1)
  })

  test("#given one gigantic line #when condensing #then caps the line and still fits the budget", () => {
    // given
    const text = `start-${"x".repeat(100_000)}-end`

    // when
    const result = condenseOutput(text, { budgetChars: 4000, hints: [] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output.length).toBeLessThanOrEqual(4000)
    expect(result.output).toContain("start-")
  })

  test("#given emoji-dense oversized output #when condensing #then truncation never produces lone surrogates", () => {
    // given
    const text = `x${"🚀🔥💾".repeat(40_000)}\n`

    // when
    const result = condenseOutput(text, { budgetChars: 3000, hints: [] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output.isWellFormed()).toBe(true)
    expect(result.output.length).toBeLessThanOrEqual(3000)
  })

  test("#given many signature lines beyond the budget #when condensing #then output never exceeds the budget", () => {
    // given
    const text = buildLog(6000, (index) => `ERROR: failure ${index} while processing batch with a fairly long message tail`)

    // when
    const result = condenseOutput(text, { budgetChars: 5000, hints: [] })

    // then
    expect(result.condensed).toBe(true)
    expect(result.output.length).toBeLessThanOrEqual(5000)
    expect(result.output).toContain("[sparkshell] condensed:")
  })
})

describe("extractContextHints", () => {
  test("#given user requests #when extracting hints #then yields backticked terms, paths, and identifiers without noise", () => {
    // given
    const first = "Fix the flaky login test in `auth-session.ts` and check src/services/token-refresh.ts behavior"
    const latest = "Now make refreshAccessToken stop racing and ship MAX_RETRY_COUNT handling"

    // when
    const hints = extractContextHints([first, latest])

    // then
    expect(hints).toContain("auth-session.ts")
    expect(hints).toContain("src/services/token-refresh.ts")
    expect(hints).toContain("token-refresh.ts")
    expect(hints).toContain("refreshAccessToken")
    expect(hints).toContain("MAX_RETRY_COUNT")
    expect(hints).not.toContain("the")
    expect(hints).not.toContain("test")
  })

  test("#given empty requests #when extracting hints #then returns no hints", () => {
    expect(extractContextHints(["", "   "])).toEqual([])
  })

  test("#given hint cap pressure from many paths #when extracting hints #then basenames ride along with their full paths", () => {
    // given
    const flood = Array.from({ length: 40 }, (_, index) => `pkg/dir${index}/module-${index}.ts`).join(" ")

    // when
    const hints = extractContextHints([flood])

    // then
    expect(hints).toContain("pkg/dir0/module-0.ts")
    expect(hints).toContain("module-0.ts")
  })

  test("#given a flood of identifiers #when extracting hints #then caps the hint count", () => {
    // given
    const flood = Array.from({ length: 100 }, (_, index) => `token_${index}_name`).join(" ")

    // when
    const hints = extractContextHints([flood])

    // then
    expect(hints.length).toBeLessThanOrEqual(32)
  })
})
