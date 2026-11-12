import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import { resolveModelWithFallback } from "./model-resolver"
import type { FallbackEntry } from "./model-requirement-types"

const LUNA_LOW = {
  providers: ["openai", "chatgpt-subscription"],
  model: "gpt-6-luna-fast",
  variant: "low",
} satisfies FallbackEntry

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "off",
} satisfies FallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "max",
} satisfies FallbackEntry

const KIMI_HIGHSPEED_OFF = {
  providers: ["kimi-for-coding"],
  model: "kimi-for-coding-highspeed",
  variant: "off",
} satisfies FallbackEntry

describe("Luna and DeepSeek chain policy", () => {
  test("quick leads with Luna low, Haiku 5.5 medium, then non-reasoning DeepSeek V4.1 Flash", () => {
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain

    expect(quick.map((entry) => entry.model)).not.toContain("kimi-for-coding-highspeed")
    expect(quick.slice(0, 3)).toEqual([
      LUNA_LOW,
      { providers: ["anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
      DEEPSEEK_OFF,
    ])
  })

  test.each(["explore", "librarian"])(
    "%s leads with no-thinking Kimi HighSpeed, Luna, Haiku 5.5 medium, then max-reasoning DeepSeek V4.1 Flash",
    (agentName) => {
      const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain

      expect(chain.slice(0, 4)).toEqual([
        KIMI_HIGHSPEED_OFF,
        { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["anthropic", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
        DEEPSEEK_MAX,
      ])
    },
  )
})

const VERTEX_FLASH_OFF = {
  providers: ["vertex-garden"],
  model: "deepseek-v4.1-flash-maas",
  variant: "off",
} satisfies FallbackEntry

const VERTEX_FLASH_MEDIUM = {
  providers: ["vertex-garden"],
  model: "deepseek-v4.1-flash-maas",
  variant: "medium",
} satisfies FallbackEntry

describe("Vertex Model Garden DeepSeek lane", () => {
  test("#given the quick chain #when scanning rung 3 #then the non-reasoning Vertex Flash rung sits right after first-party DeepSeek", () => {
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain

    expect(quick[3]).toEqual(VERTEX_FLASH_OFF)
  })

  test.each(["explore", "librarian"])(
    "#given the %s chain #when scanning rung 4 #then first-party DeepSeek max is followed by the Vertex Flash medium lane",
    (agentName) => {
      const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain

      expect(chain[4]).toEqual(VERTEX_FLASH_MEDIUM)
    },
  )

  test("#given the unspecified-low chain #when deepseek-v4-pro is located #then the Vertex Flash medium lane follows it", () => {
    const chain = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"].fallbackChain
    const proIndex = chain.findIndex((entry) => entry.model === "deepseek-v4-pro")

    expect(proIndex).toBeGreaterThanOrEqual(0)
    expect(chain[proIndex + 1]).toEqual(VERTEX_FLASH_MEDIUM)
  })

  test("#given a Vertex-only machine #when resolving the quick chain #then it lands on the Garden's namespaced Flash via provider-fallback", () => {
    const resolved = resolveModelWithFallback({
      fallbackChain: CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain,
      availableModels: new Set(["vertex-garden/deepseek-ai/deepseek-v4.1-flash-maas"]),
    })

    expect(resolved?.model).toBe("vertex-garden/deepseek-ai/deepseek-v4.1-flash-maas")
    expect(resolved?.source).toBe("provider-fallback")
  })
})
