/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  createDynamicTruncator,
  dynamicTruncate,
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

function createDynamicThresholdOutput(): string {
  return [
    "header",
    "content one ".repeat(7),
    "content two ".repeat(7),
    "content three ".repeat(7),
    "content four ".repeat(7),
    "content five ".repeat(7),
    "content six ".repeat(7),
  ].join("\n")
}

describe("dynamicTruncate threshold behavior", () => {
  it("#then limits output to half of the remaining context window when that is below the target", async () => {
    // given
    const ctx = createContextUsageMockContext(199800)

    // when
    const result = await dynamicTruncate(
      ctx as never,
      "ses_half_remaining_threshold",
      createDynamicThresholdOutput(),
      { targetMaxTokens: 1000, preserveHeaderLines: 1 },
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(result).toEqual({
      result: [
        "header",
        "content one ".repeat(7),
        "content two ".repeat(7),
        "",
        "[4 more lines truncated due to context window limit]",
      ].join("\n"),
      truncated: true,
      removedCount: 4,
    })
  })

  it("#then caps output at the requested target when half of the remaining context is larger", async () => {
    // given
    const ctx = createContextUsageMockContext(198000)

    // when
    const result = await dynamicTruncate(
      ctx as never,
      "ses_target_threshold",
      createDynamicThresholdOutput(),
      { targetMaxTokens: 80, preserveHeaderLines: 1 },
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(result).toEqual({
      result: [
        "header",
        "content one ".repeat(7),
        "",
        "[5 more lines truncated due to context window limit]",
      ].join("\n"),
      truncated: true,
      removedCount: 5,
    })
  })

  it("#then leaves output unchanged when it is below the dynamic token budget", async () => {
    // given
    const ctx = createContextUsageMockContext(100000)
    const output = "short output"

    // when
    const result = await dynamicTruncate(
      ctx as never,
      "ses_under_dynamic_budget",
      output,
      { targetMaxTokens: 100, preserveHeaderLines: 1 },
      { anthropicContext1MEnabled: false },
    )

    // then
    expect(result).toEqual({
      result: output,
      truncated: false,
    })
  })
})

describe("createDynamicTruncator threshold behavior", () => {
  it("#then routes truncate through the dynamic context-aware threshold", async () => {
    // given
    const ctx = createContextUsageMockContext(199800)
    const truncator = createDynamicTruncator(ctx as never, {
      anthropicContext1MEnabled: false,
    })

    // when
    const result = await truncator.truncate(
      "ses_facade_truncate",
      createDynamicThresholdOutput(),
      { targetMaxTokens: 1000, preserveHeaderLines: 1 },
    )

    // then
    expect(result).toEqual({
      result: [
        "header",
        "content one ".repeat(7),
        "content two ".repeat(7),
        "",
        "[4 more lines truncated due to context window limit]",
      ].join("\n"),
      truncated: true,
      removedCount: 4,
    })
  })
})
