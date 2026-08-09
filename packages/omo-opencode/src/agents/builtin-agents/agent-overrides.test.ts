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
  test("selects the canonical primary model without storing its request settings as agent defaults", () => {
    const base = makeBase({ temperature: 0.1 })
    const categories: Record<string, CategoryConfig> = {
      research: {
        models: [{
          model: "openai/gpt-5.6-sol-primary",
          reasoning: "high",
          temperature: 0.2,
          max_tokens: 1024,
          provider_options: { serviceTier: "priority" },
        }],
      },
    }

    const result = applyCategoryOverride(base, "research", categories)

    expect(result.model).toBe("openai/gpt-5.6-sol-primary")
    expect(result.variant).toBeUndefined()
    expect(result.temperature).toBe(0.1)
    expect((result as AgentConfig & { maxTokens?: number }).maxTokens).toBeUndefined()
    expect((result as AgentConfig & { providerOptions?: unknown }).providerOptions).toBeUndefined()
  })

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

    test("keeps canonical primary tuning out of the OpenCode agent defaults", () => {
      const base = makeBase({ temperature: 0.1 })
      const override: AgentOverrideConfig = {
        model: "openai/primary",
        models: [
          { model: "openai/primary", reasoning: "high", temperature: 0.2 },
          "openai/fallback",
        ],
        fallback_models: ["openai/fallback"],
        reasoning: "high",
        temperature: 0.2,
        maxTokens: 1024,
        providerOptions: { serviceTier: "priority" },
      }

      const result = mergeAgentConfig(base, override)

      expect(result.model).toBe("openai/primary")
      expect(result.variant).toBeUndefined()
      expect(result.temperature).toBe(0.1)
      expect((result as AgentConfig & { maxTokens?: number }).maxTokens).toBeUndefined()
      expect((result as AgentConfig & { providerOptions?: unknown }).providerOptions).toBeUndefined()
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
})
