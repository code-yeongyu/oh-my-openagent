import { describe, expect, test } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { CategoryConfig } from "../../config/schema"
import { applyCategoryOverride, applyOverrides, mergeAgentConfig } from "./agent-overrides"
import type { AgentOverrideConfig } from "../types"

function makeBase(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    instructions: "test prompt",
    model: "openai/gpt-5.6-sol",
    mode: "primary",
    ...overrides,
  } as AgentConfig
}

describe("applyCategoryOverride", () => {
  describe("#given canonical reasoning on category", () => {
    test("lowers category reasoning to variant on the agent config", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { reasoning: "xhigh" } as CategoryConfig,
      }

      // when
      const result = applyCategoryOverride(base, "ultrabrain", categories)

      // then
      expect(result.variant).toBe("xhigh")
    })

    test("reasoning takes precedence over deprecated variant", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { reasoning: "high", variant: "medium" } as CategoryConfig,
      }

      // when
      const result = applyCategoryOverride(base, "ultrabrain", categories)

      // then
      expect(result.variant).toBe("high")
    })

    test("deprecated variant still applied when reasoning is absent", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { variant: "medium" } as CategoryConfig,
      }

      // when
      const result = applyCategoryOverride(base, "ultrabrain", categories)

      // then
      expect(result.variant).toBe("medium")
    })
  })
})

describe("mergeAgentConfig", () => {
  describe("#given canonical reasoning on agent override", () => {
    test("lowers reasoning to variant on the merged config", () => {
      // given
      const base = makeBase()
      const override: AgentOverrideConfig = { reasoning: "high" }

      // when
      const result = mergeAgentConfig(base, override)

      // then
      expect(result.variant).toBe("high")
    })

    test("reasoning takes precedence over deprecated variant in override", () => {
      // given
      const base = makeBase()
      const override: AgentOverrideConfig = { reasoning: "high", variant: "medium" }

      // when
      const result = mergeAgentConfig(base, override)

      // then
      expect(result.variant).toBe("high")
    })

    test("deprecated variant still applied when reasoning is absent", () => {
      // given
      const base = makeBase()
      const override: AgentOverrideConfig = { variant: "medium" }

      // when
      const result = mergeAgentConfig(base, override)

      // then
      expect(result.variant).toBe("medium")
    })

    test("reasoning overrides base variant from factory defaults", () => {
      // given
      const base = makeBase({ variant: "low" })
      const override: AgentOverrideConfig = { reasoning: "high" }

      // when
      const result = mergeAgentConfig(base, override)

      // then
      expect(result.variant).toBe("high")
    })

    test("does not set variant when neither reasoning nor variant is in override", () => {
      // given
      const base = makeBase({ variant: "low" })
      const override: AgentOverrideConfig = { temperature: 0.5 }

      // when
      const result = mergeAgentConfig(base, override)

      // then
      expect(result.variant).toBe("low")
    })
  })
})

describe("applyOverrides", () => {
  describe("#given both category and agent reasoning", () => {
    test("agent reasoning takes precedence over category reasoning", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { reasoning: "medium" } as CategoryConfig,
      }
      const override: AgentOverrideConfig = {
        category: "ultrabrain",
        reasoning: "high",
      }

      // when
      const result = applyOverrides(base, override, categories)

      // then
      expect(result.variant).toBe("high")
    })

    test("agent reasoning takes precedence over category variant", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { variant: "medium" } as CategoryConfig,
      }
      const override: AgentOverrideConfig = {
        category: "ultrabrain",
        reasoning: "high",
      }

      // when
      const result = applyOverrides(base, override, categories)

      // then
      expect(result.variant).toBe("high")
    })

    test("category reasoning applied when agent has no reasoning or variant", () => {
      // given
      const base = makeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { reasoning: "high" } as CategoryConfig,
      }
      const override: AgentOverrideConfig = {
        category: "ultrabrain",
        temperature: 0.3,
      }

      // when
      const result = applyOverrides(base, override, categories)

      // then
      expect(result.variant).toBe("high")
    })
  })

  describe("#given a manual-path Claude thinking config", () => {
    function makeClaudeBase(overrides: Partial<AgentConfig> = {}): AgentConfig {
      return {
        instructions: "test prompt",
        model: "anthropic/claude-sonnet-5",
        mode: "subagent",
        thinking: { type: "enabled", budgetTokens: 32000 },
        ...overrides,
      } as AgentConfig
    }

    function readThinking(config: AgentConfig): { type?: unknown; budgetTokens?: unknown } {
      const candidate = config as AgentConfig & { thinking?: { type?: unknown; budgetTokens?: unknown } }
      return candidate.thinking ?? {}
    }

    test("re-derives budgetTokens from the resolved variant", () => {
      // given
      const base = makeClaudeBase({ variant: "max" })

      // when
      const result = applyOverrides(base, undefined, {})

      // then
      expect(readThinking(result)).toEqual({ type: "enabled", budgetTokens: 60000 })
    })

    test("different variants produce different budgets", () => {
      // given
      const lowBase = makeClaudeBase({ variant: "low" })
      const maxBase = makeClaudeBase({ variant: "max" })

      // when
      const lowResult = applyOverrides(lowBase, undefined, {})
      const maxResult = applyOverrides(maxBase, undefined, {})

      // then
      expect(readThinking(lowResult).budgetTokens).toBe(8192)
      expect(readThinking(maxResult).budgetTokens).toBe(60000)
    })

    test("keeps the legacy default budget when no variant is resolved", () => {
      // given
      const base = makeClaudeBase()

      // when
      const result = applyOverrides(base, undefined, {})

      // then
      expect(readThinking(result)).toEqual({ type: "enabled", budgetTokens: 32000 })
    })

    test("explicit override thinking wins over the variant-derived budget", () => {
      // given
      const base = makeClaudeBase({ variant: "max" })
      const override: AgentOverrideConfig = {
        thinking: { type: "enabled", budgetTokens: 12345 },
      }

      // when
      const result = applyOverrides(base, override, {})

      // then
      expect(readThinking(result)).toEqual({ type: "enabled", budgetTokens: 12345 })
    })

    test("explicit category thinking wins over the variant-derived budget", () => {
      // given
      const base = makeClaudeBase({ variant: "max" })
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": {
          variant: "max",
          thinking: { type: "enabled", budgetTokens: 54321 },
        } as CategoryConfig,
      }
      const override: AgentOverrideConfig = { category: "ultrabrain" }

      // when
      const result = applyOverrides(base, override, categories)

      // then
      expect(readThinking(result)).toEqual({ type: "enabled", budgetTokens: 54321 })
    })

    test("derives from the final variant when both category and direct reasoning are set", () => {
      // given
      const base = makeClaudeBase()
      const categories: Record<string, CategoryConfig> = {
        "ultrabrain": { reasoning: "low" } as CategoryConfig,
      }
      const override: AgentOverrideConfig = {
        category: "ultrabrain",
        reasoning: "medium",
      }

      // when
      const result = applyOverrides(base, override, categories)

      // then
      expect(result.variant).toBe("medium")
      expect(readThinking(result)).toEqual({ type: "enabled", budgetTokens: 16000 })
    })

    test("leaves non-enabled thinking configs untouched", () => {
      // given
      const base = makeClaudeBase({
        variant: "max",
        thinking: { type: "adaptive" },
      } as Partial<AgentConfig>)

      // when
      const result = applyOverrides(base, undefined, {})

      // then
      expect(readThinking(result)).toEqual({ type: "adaptive" })
    })
  })
})
