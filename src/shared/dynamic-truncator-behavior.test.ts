/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  createDynamicTruncator,
  dynamicTruncate,
  truncateToTokenLimit,
} from "./dynamic-truncator"

function createContextUsageMockContext(inputTokens: number) {
  return {
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                role: "assistant",
                providerID: "anthropic",
                modelID: "claude-sonnet-4-5",
                tokens: {
                  input: inputTokens,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
            },
          ],
        }),
      },
    },
  }
}

function createNoUsageMockContext() {
  return {
    client: {
      session: {
        messages: async () => ({ data: [] }),
      },
    },
  }
}

describe("truncateToTokenLimit", () => {
  it("#then preserves configured header lines and reports removed content lines", () => {
    // given
    const output = [
      "header one",
      "header two",
      "content one",
      "content two ".repeat(80),
      "content three ".repeat(80),
    ].join("\n")

    // when
    const result = truncateToTokenLimit(output, 60, 2)

    // then
    expect(result).toEqual({
      result: [
        "header one",
        "header two",
        "content one",
        "",
        "[2 more lines truncated due to context window limit]",
      ].join("\n"),
      truncated: true,
      removedCount: 2,
    })
  })

  it("#then truncates by characters when the output has no removable body lines", () => {
    // given
    const output = "abcdefghijklmnopqrstuvwxyz"

    // when
    const result = truncateToTokenLimit(output, 3, 3)

    // then
    expect(result).toEqual({
      result: "abcdefghijkl\n\n[Output truncated due to context window limit]",
      truncated: true,
    })
  })
})

describe("dynamicTruncate", () => {
  it("#then falls back to the target token limit when context usage is unavailable", async () => {
    // given
    const ctx = createNoUsageMockContext()
    const output = [
      "header",
      "line one",
      "line two ".repeat(80),
      "line three ".repeat(80),
    ].join("\n")

    // when
    const result = await dynamicTruncate(
      ctx as never,
      "ses_no_usage_for_truncate",
      output,
      { targetMaxTokens: 55, preserveHeaderLines: 1 },
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(result).toEqual({
      result: [
        "header",
        "line one",
        "",
        "[2 more lines truncated due to context window limit]",
      ].join("\n"),
      truncated: true,
      removedCount: 2,
    })
  })

  it("#then suppresses output when the context window is exhausted", async () => {
    // given
    const ctx = createContextUsageMockContext(210000)

    // when
    const result = await dynamicTruncate(
      ctx as never,
      "ses_exhausted_for_truncate",
      "content",
      {},
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(result).toEqual({
      result: "[Output suppressed - context window exhausted]",
      truncated: true,
    })
  })
})

describe("createDynamicTruncator", () => {
  it("#then exposes async usage and sync truncation helpers", async () => {
    // given
    const ctx = createContextUsageMockContext(100000)
    const truncator = createDynamicTruncator(ctx as never, {
      anthropicContext1MEnabled: false,
    })

    // when
    const usage = await truncator.getUsage("ses_facade_usage")
    const syncResult = truncator.truncateSync("abcdefghijklmnopqrstuvwxyz", 3, 3)

    // then
    expect(usage?.remainingTokens).toBe(100000)
    expect(syncResult).toEqual({
      result: "abcdefghijkl\n\n[Output truncated due to context window limit]",
      truncated: true,
    })
  })
})
