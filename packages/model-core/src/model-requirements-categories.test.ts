import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain keeps native gpt-5.6-sol xhigh before Copilot high and Gemini", () => {
    // given
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when
    const [primary, copilot, opencodeSol, geminiFallback] = ultrabrain.fallbackChain

    // then
    expect(ultrabrain.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.model).toBe("gpt-5.6-sol")
    expect(primary?.providers[0]).toBe("openai")
    expect(copilot).toEqual({
      providers: ["github-copilot"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
    expect(opencodeSol).toEqual({
      providers: ["openai", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "xhigh",
    })
    expect(geminiFallback?.model).toBe("gemini-3.1-pro")
    expect(geminiFallback?.variant).toBe("high")
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

  test("visual-engineering follows the approved 3-rung chain", () => {
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
    ])
  })

  test("quick follows the approved 5-rung chain", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const chain = quick.fallbackChain

    // then
    expect(chain).toEqual([
      { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed" },
      { providers: ["quotio-openai"], model: "gpt-5.4-mini-fast", variant: "minimal" },
      { providers: ["openai"], model: "gpt-5.4-mini", variant: "minimal" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      { providers: ["xiaomi"], model: "mimo-v2.5-pro-ultraspeed" },
    ])
  })

  test("unspecified-low follows the approved 7-rung chain", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const chain = unspecifiedLow.fallbackChain

    // then
    expect(chain).toEqual([
      {
        providers: ["openai", "quotio-openai", "vercel"],
        model: "gpt-5.6-luna",
        variant: "xhigh",
      },
      {
        providers: ["github-copilot"],
        model: "gpt-5.6-luna",
        variant: "high",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-5",
        variant: "medium",
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
      { providers: ["cursor"], model: "composer-2.5" },
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
