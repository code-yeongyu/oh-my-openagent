declare const require: (name: string) => unknown
const { describe, test, expect } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toContain: (expected: string) => void
    not: {
      toContain: (expected: string) => void
    }
    toBeLessThanOrEqual: (expected: number) => void
    toBeUndefined: () => void
  }
}

import {
  buildSystemContentWithTokenLimit,
  estimateTokenCount,
  truncateToTokenBudget,
} from "./token-limiter"

const TRUNCATION_MARKER_TOKEN_OVERHEAD = estimateTokenCount("\n[TRUNCATED]")

describe("token-limiter", () => {
  test("estimateTokenCount uses 1 token per 4 chars approximation", () => {
    // given
    const text = "12345678"

    // when
    const result = estimateTokenCount(text)

    // then
    expect(result).toBe(2)
  })

  test("truncateToTokenBudget keeps text within requested token budget", () => {
    // given
    const content = "A".repeat(120)
    const maxTokens = 10

    // when
    const result = truncateToTokenBudget(content, maxTokens)

    // then
    expect(estimateTokenCount(result)).toBeLessThanOrEqual(maxTokens + TRUNCATION_MARKER_TOKEN_OVERHEAD)
  })

  describe("truncateToTokenBudget", () => {
    describe("#given content that exceeds budget", () => {
      describe("#when content has newlines", () => {
        test("#then should truncate at last newline boundary", () => {
          // #given
          const content = "line-1\nline-2\nline-3"

          // #when
          const result = truncateToTokenBudget(content, 2)

          // #then
          expect(result).toBe("line-1\n[TRUNCATED]")
        })

        test("#then should append [TRUNCATED] marker", () => {
          // #given
          const content = "line-1\nline-2\nline-3"

          // #when
          const result = truncateToTokenBudget(content, 2)

          // #then
          expect(result).toContain("[TRUNCATED]")
        })
      })

      describe("#when content is single long line with no newlines", () => {
        test("#then should slice and append [TRUNCATED] marker", () => {
          // #given
          const content = "A".repeat(30)

          // #when
          const result = truncateToTokenBudget(content, 2)

          // #then
          expect(result).toBe("AAAAAAAA\n[TRUNCATED]")
        })
      })
    })

    describe("#given content within budget", () => {
      test("#then should return content unchanged without marker", () => {
        // #given
        const content = "line-1\nline-2"

        // #when
        const result = truncateToTokenBudget(content, 20)

        // #then
        expect(result).toBe(content)
        expect(result).not.toContain("[TRUNCATED]")
      })
    })
  })

  test("buildSystemContentWithTokenLimit returns undefined when there is no content", () => {
    // given
    const input = {
      skillContent: undefined,
      skillContents: [],
      categoryPromptAppend: undefined,
      agentsContext: undefined,
      planAgentPrepend: "",
    }

    // when
    const result = buildSystemContentWithTokenLimit(input, 20)

    // then
    expect(result).toBeUndefined()
  })

  test("buildSystemContentWithTokenLimit truncates skills before category and agents context", () => {
    // given
    const input = {
      skillContents: [
        "SKILL_ALPHA:" + "a".repeat(180),
        "SKILL_BETA:" + "b".repeat(180),
      ],
      categoryPromptAppend: "CATEGORY_APPEND:keep",
      agentsContext: "AGENTS_CONTEXT:keep",
      planAgentPrepend: "",
    }

    // when
    const result = buildSystemContentWithTokenLimit(input, 80)

    // then
    expect(result).toContain("AGENTS_C")
    expect(result).toContain("CATE")
    expect(result).toContain("SKILL_ALPHA:")
    expect(estimateTokenCount(result as string)).toBeLessThanOrEqual(80 + TRUNCATION_MARKER_TOKEN_OVERHEAD)
  })

  test("buildSystemContentWithTokenLimit truncates category after skills are exhausted", () => {
    // given
    const input = {
      skillContents: ["SKILL_ALPHA:" + "a".repeat(220)],
      categoryPromptAppend: "CATEGORY_APPEND:" + "c".repeat(220),
      agentsContext: "AGENTS_CONTEXT:keep",
      planAgentPrepend: "",
    }

    // when
    const result = buildSystemContentWithTokenLimit(input, 30)

    // then
    expect(result).toContain("AGENTS_C")
    expect(result).not.toContain("SKILL_ALPHA:" + "a".repeat(80))
    expect(estimateTokenCount(result as string)).toBeLessThanOrEqual(30 + TRUNCATION_MARKER_TOKEN_OVERHEAD)
  })

  test("buildSystemContentWithTokenLimit truncates agents context last", () => {
    // given
    const input = {
      skillContents: ["SKILL_ALPHA:" + "a".repeat(220)],
      categoryPromptAppend: "CATEGORY_APPEND:" + "c".repeat(220),
      agentsContext: "AGENTS_CONTEXT:" + "g".repeat(220),
      planAgentPrepend: "",
    }

    // when
    const result = buildSystemContentWithTokenLimit(input, 10)

    // then
    expect(result).toContain("AGENTS_CONTEXT:")
    expect(result).not.toContain("SKILL_ALPHA:")
    expect(result).not.toContain("CATEGORY_APPEND:")
    expect(estimateTokenCount(result as string)).toBeLessThanOrEqual(10 + TRUNCATION_MARKER_TOKEN_OVERHEAD)
  })
})
