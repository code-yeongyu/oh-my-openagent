import { describe, it, expect } from "bun:test"

import { classifyIntent } from "./classifier"

describe("classifyIntent", () => {
  describe("TRIVIAL", () => {
    it("classifies short what-question about agent config", () => {
      // given
      const message = "what temperature does oracle use?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies short what-question about file location", () => {
      // given
      const message = "what file defines the explore agent?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies short what-question about agent purpose", () => {
      // given
      const message = "what does momus do?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies short what-question about fallback chain", () => {
      // given
      const message = "what is the fallback chain for sisyphus?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies list-prefixed question about agents", () => {
      // given
      const message = "list all agents that are read-only"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies show-prefixed question", () => {
      // given
      const message = "show me all available hooks"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies which-prefixed question", () => {
      // given
      const message = "which model does sisyphus use?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies who-prefixed question", () => {
      // given
      const message = "who handles the session.idle event?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("classifies where-prefixed question", () => {
      // given
      const message = "where is the config schema defined?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })
  })

  describe("MODERATE", () => {
    it("classifies single-line comment addition", () => {
      // given
      const message = "add a comment to line 5 of librarian.ts"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("classifies rename task across codebase", () => {
      // given
      const message = "rename getAgentCost to getAgentPriceTier across the codebase"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("classifies targeted type error fix", () => {
      // given
      const message = "fix the type error on line 42 of oracle.ts"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("classifies adding a specific tool call to a file", () => {
      // given
      const message = "add lsp_diagnostics call after the edit in explore.ts"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("classifies version bump in package.json", () => {
      // given
      const message = "update the version number in package.json to 3.16.0"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("classifies adding missing export to barrel index", () => {
      // given
      const message = "add the missing export to the agents barrel index"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })
  })

  describe("COMPLEX", () => {
    it("classifies improve-keyword request", () => {
      // given
      const message = "improve the error handling in the agents directory"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies implement-keyword request", () => {
      // given
      const message = "implement a pre-classifier hook in oh-my-openagent"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies look into combined with create PR", () => {
      // given
      const message = "look into the performance issue and create a PR"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies how-should-I architectural question", () => {
      // given
      const message = "how should I architect the caching layer?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies refactor-keyword request", () => {
      // given
      const message = "refactor the model resolution pipeline to support 4-tier fallback"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies analyze-keyword request", () => {
      // given
      const message = "analyze why sisyphus is slow and suggest optimizations"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies build-keyword request", () => {
      // given
      const message = "build a new tool for session introspection"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("classifies why-keyword question", () => {
      // given
      const message = "why does the context window monitor fire twice?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })
  })

  describe("edge cases", () => {
    it("TRIVIAL prefix does not apply when message exceeds 20 words", () => {
      // given
      const message =
        "what is the exact reasoning behind the decision to use nested describe blocks with given when then style in all test files across the project?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("MODERATE")
    })

    it("COMPLEX pattern wins even when message starts with trivial prefix", () => {
      // given
      const message = "what should I implement to fix the retry logic?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("COMPLEX")
    })

    it("handles leading/trailing whitespace", () => {
      // given
      const message = "  list all hooks  "

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })

    it("TRIVIAL prefix match is case-insensitive", () => {
      // given
      const message = "WHAT model does oracle use?"

      // when
      const result = classifyIntent(message)

      // then
      expect(result).toBe("TRIVIAL")
    })
  })
})
