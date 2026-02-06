import { describe, expect, test, mock } from "bun:test"
import {
  getContextWindowUsage,
  truncateToTokenLimit,
  createDynamicTruncator,
} from "./dynamic-truncator"

function createMockCtx(messagesData: Array<{
  info: {
    role: string
    tokens?: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
  }
}>) {
  return {
    client: {
      session: {
        messages: mock(() =>
          Promise.resolve({
            data: messagesData,
          }),
        ),
      },
    },
  } as any
}

describe("getContextWindowUsage", () => {
  test("returns remainingTokens from resolved model-specific sonnet 1M limit", async () => {
    //#given
    const mockCtx = createMockCtx([
      {
        info: {
          role: "assistant",
          tokens: {
            input: 150000,
            output: 5000,
            reasoning: 0,
            cache: { read: 10000, write: 0 },
          },
        },
      },
    ])

    //#when
    const usage = await getContextWindowUsage(mockCtx, "session-1")

    //#then
    expect(usage).not.toBeNull()
    expect(usage!.usedTokens).toBe(165000)
    expect(usage!.remainingTokens).toBe(835000)
  })

  test("returns usagePercentage based on resolved model-specific limit", async () => {
    //#given
    const mockCtx = createMockCtx([
      {
        info: {
          role: "assistant",
          tokens: {
            input: 150000,
            output: 5000,
            reasoning: 0,
            cache: { read: 10000, write: 0 },
          },
        },
      },
    ])

    //#when
    const usage = await getContextWindowUsage(mockCtx, "session-1")

    //#then
    expect(usage).not.toBeNull()
    expect(usage!.usagePercentage).toBeCloseTo(0.165, 6)
  })

  test("returns null when there are no assistant messages", async () => {
    //#given
    const mockCtx = createMockCtx([
      {
        info: {
          role: "user",
        },
      },
    ])

    //#when
    const usage = await getContextWindowUsage(mockCtx, "session-2")

    //#then
    expect(usage).toBeNull()
  })

  test("uses 200k denominator when env var is unset and model cache is not used", async () => {
    //#given
    const mockCtx = createMockCtx([
      {
        info: {
          role: "assistant",
          tokens: {
            input: 150000,
            output: 5000,
            reasoning: 0,
            cache: { read: 10000, write: 0 },
          },
        },
      },
    ])
    const truncator = createDynamicTruncator(mockCtx)

    //#when
    const usage = await truncator.getUsage("session-3")

    //#then
    expect(usage).not.toBeNull()
    expect(usage!.usedTokens).toBe(165000)
    expect(usage!.remainingTokens).toBe(35000)
    expect(usage!.usagePercentage).toBeCloseTo(0.825, 6)
  })
})

describe("truncateToTokenLimit", () => {
  test("correctly truncates output exceeding max tokens", () => {
    //#given
    const output = [
      "Header 1",
      "Header 2",
      "Header 3",
      "A".repeat(2000),
      "B".repeat(2000),
    ].join("\n")

    //#when
    const result = truncateToTokenLimit(output, 100, 3)

    //#then
    expect(result.truncated).toBe(true)
    expect(result.removedCount).toBeGreaterThanOrEqual(1)
    expect(result.result).toContain("truncated due to context window limit")
  })
})
