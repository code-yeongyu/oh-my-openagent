import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain is gpt-5.6-sol max on every rung", () => {
    // given
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when
    const chain = ultrabrain.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "quotio-openai", "vercel"],
        model: "gpt-5.6-sol",
        variant: "max",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-sol",
        variant: "max",
      },
      {
        providers: ["openai", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "max",
      },
    ])
  })

  test("deep is a single sol-family medium rung", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const [primary] = deep.fallbackChain

    // then
    expect(deep.fallbackChain).toHaveLength(1)
    expect(primary).toEqual({
      providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "medium",
    })
  })

  test("visual-engineering follows the approved 4-rung chain", () => {
    // given
    const visualEngineering = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const chain = visualEngineering.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "max",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["zai-coding-plan", "opencode-go", "vercel"],
        model: "glm-5.2",
        variant: "max",
      },
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "medium",
      },
    ])
  })

  test("quick follows the approved 8-rung chain", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const chain = quick.fallbackChain

    // then
    expect(chain).toEqual([
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
      {
        providers: ["deepseek"],
        model: "deepseek-v4-flash",
        variant: "off",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan", "vercel"],
        model: "qwen3.6-flash",
        variant: "low",
      },
      { providers: ["opencode-go", "vercel"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go", "vercel"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "vercel"],
        model: "claude-haiku-4-5",
        variant: "off",
      },
    ])
  })

  test("unspecified-low follows the approved 6-rung chain headed by grok-4.6 xhigh", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const chain = unspecifiedLow.fallbackChain

    // then
    expect(chain.map((entry) => entry.model)).not.toContain("gpt-5.6-luna")
    expect(chain).toEqual([
      {
        providers: ["xai", "github-copilot", "opencode", "vercel"],
        model: "grok-4.6",
        variant: "xhigh",
      },
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-5",
        variant: "low",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go", "vercel"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go", "vercel"],
        model: "mimo-v2.5-pro",
        variant: "max",
      },
    ])
  })

  test("unspecified-high follows the approved 3-rung chain", () => {
    // given
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const chain = unspecifiedHigh.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "xhigh",
      },
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-sol",
        variant: "high",
      },
    ])
  })

  test("artistry follows the approved 3-rung chain", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const chain = artistry.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-fable-5",
        variant: "xhigh",
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "max",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "xhigh",
      },
    ])
  })

  test("writing follows the approved 3-rung chain", () => {
    // given
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const chain = writing.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode", "vercel"],
        model: "kimi-k3",
        variant: "low",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-opus-5",
        variant: "low",
      },
      {
        providers: ["google", "github-copilot", "opencode", "vercel"],
        model: "gemini-3.6-flash",
      },
    ])
  })

  test("deep and artistry no longer hard-require primary models", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when / then
    expect(deep.requiresModel).toBeUndefined()
    expect(artistry.requiresModel).toBeUndefined()
  })
})
