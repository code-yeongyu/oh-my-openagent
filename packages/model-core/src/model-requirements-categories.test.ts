import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("writing only activates when one of its own chain models is available", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["writing"].requiresAnyModel).toBe(true)
  })

  // #14155: each GPT deep lane is one exact-model rung with no older, Fast or other-family fallback, and
  // stays unavailable (requiresAnyModel) when no listed provider serves it.
  test.each([
    ["ultrabrain", ["openai", "chatgpt-subscription", "opencode"], "gpt-6.2-astra", "max"],
    ["deep-high", ["openai", "chatgpt-subscription", "opencode"], "gpt-6.2-astra", "high"],
    ["deep-low", ["openai", "chatgpt-subscription"], "gpt-6.2-sol", "medium"],
  ])("%s runs exactly one rung and requires it", (category, providers, model, variant) => {
    const requirement = CATEGORY_MODEL_REQUIREMENTS[category]

    expect(requirement.fallbackChain).toEqual([{ providers, model, variant }])
    expect(requirement.requiresAnyModel).toBe(true)
  })

  test("visual-engineering starts with Argon low (#10187)", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["visual-engineering"].fallbackChain.at(0)).toEqual({
      providers: ["google", "google-vertex", "opencode"],
      model: "gemini-4-argon",
      variant: "low",
    })
  })

  test("visual-engineering follows the approved 4-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["google", "google-vertex", "opencode"],
        model: "gemini-4-argon",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-2",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go"],
        model: "kimi-k3.1-pro",
        variant: "max",
      },
      {
        providers: ["opencode"],
        model: "kimi-k3",
        variant: "max",
      },
    ])
  })

  test("quick follows the approved 9-rung chain with Haiku 5.5 medium after Luna Fast", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "chatgpt-subscription"],
        model: "gpt-6-luna-fast",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: "claude-haiku-5-5",
        variant: "medium",
      },
      {
        providers: ["deepseek"],
        model: "deepseek-flash",
        variant: "off",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low",
      },
      {
        providers: ["opencode-go"],
        model: "minimax-m3",
        variant: "max",
      },
      {
        providers: ["opencode-go"],
        model: "minimax-m2.7",
        variant: "max",
      },
      {
        providers: ["xai"],
        model: "grok-4.20-0309-non-reasoning",
      },
      { providers: ["zai-coding-plan"], model: "glm-5.3-flash", variant: "low" },
      { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" },
    ])
  })

  test("unspecified-low follows the approved chain headed by claude-sonnet-5-5 medium", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5-5",
        variant: "medium",
      },
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.6-pro",
        variant: "max",
      },
      {
        providers: ["xai", "github-copilot", "opencode-go"],
        model: "grok-4.7",
        variant: "xhigh",
      },
      {
        providers: ["zai-coding-plan", "opencode-go"],
        model: "glm-5.3",
        variant: "high",
      },
      {
        providers: ["openai", "chatgpt-subscription"],
        model: "gpt-6.2-sol",
        variant: "medium",
      },
      {
        providers: ["openai", "chatgpt-subscription"],
        model: "gpt-6.1-sol",
        variant: "medium",
      },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5",
        variant: "low",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.5-pro",
        variant: "max",
      },
    ])
  })

  test("unspecified-high follows the approved Opus-first 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "medium",
      },
      {
        providers: ["zai-coding-plan", "opencode-go"],
        model: "glm-5.3",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go"],
        model: "kimi-k3.1-pro",
        variant: "max",
      },
      {
        providers: ["opencode"],
        model: "kimi-k3",
        variant: "max",
      },
    ])
  })

  test("artistry follows the approved 3-rung chain", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-2",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go"],
        model: "kimi-k3.1-pro",
        variant: "max",
      },
      {
        providers: ["opencode"],
        model: "kimi-k3",
        variant: "max",
      },
    ])
  })

  test("writing leads with Argon low, then claude-opus-5-5 low, and never carries claude-fable-5-1", () => {
    // given
    const requirement = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const chain = requirement.fallbackChain

    // then
    expect(chain.map(({ model }) => model)).not.toContain("claude-fable-5-1")
    expect(chain).toEqual([
      {
        providers: ["google", "google-vertex", "opencode"],
        model: "gemini-4-argon",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max",
      },
    ])
  })

  test("the deep lanes and artistry no longer hard-require primary models", () => {
    // given
    const deepLow = CATEGORY_MODEL_REQUIREMENTS["deep-low"]
    const deepHigh = CATEGORY_MODEL_REQUIREMENTS["deep-high"]
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when / then
    expect(deepLow.requiresModel).toBeUndefined()
    expect(deepHigh.requiresModel).toBeUndefined()
    expect(artistry.requiresModel).toBeUndefined()
  })
})
