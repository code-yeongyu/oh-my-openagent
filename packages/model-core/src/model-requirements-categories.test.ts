import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain keeps native gpt-5.6-sol xhigh before Copilot high and gpt-5.5", () => {
    // given
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when
    const [primary, copilot, legacyFallback] = ultrabrain.fallbackChain

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
    expect(legacyFallback?.model).toBe("gpt-5.5")
    expect(legacyFallback?.variant).toBe("xhigh")
  })

  test("deep keeps native gpt-5.6-terra xhigh before Copilot terra high and shared sol high", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const [primary, copilot, sharedSol, legacyFallback] = deep.fallbackChain

    // then
    expect(deep.fallbackChain.length).toBeGreaterThan(2)
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.model).toBe("gpt-5.6-terra")
    expect(primary?.providers).toContain("openai")
    expect(primary?.providers).not.toContain("venice")
    expect(copilot).toEqual({
      providers: ["github-copilot"],
      model: "gpt-5.6-terra",
      variant: "high",
    })
    expect(sharedSol).toEqual({
      providers: ["openai", "github-copilot", "vercel"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
    expect(legacyFallback?.model).toBe("gpt-5.5")
    expect(legacyFallback?.variant).toBe("medium")
    expect(legacyFallback?.providers).toContain("github-copilot")
  })

  test("visual-engineering keeps gemini, glm, opus, opencode-go, and k2p5 fallback order", () => {
    // given
    const visualEngineering = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const [primary, second, third, fourth, fifth] = visualEngineering.fallbackChain

    // then
    expect(visualEngineering.fallbackChain).toHaveLength(5)
    expect(primary?.providers[0]).toBe("google")
    expect(primary?.model).toBe("gemini-3.1-pro")
    expect(primary?.variant).toBe("high")
    expect(second?.providers[0]).toBe("zai-coding-plan")
    expect(second?.model).toBe("glm-5")
    expect(third?.model).toBe("claude-opus-4-8")
    expect(third?.variant).toBe("max")
    expect(fourth?.providers[0]).toBe("opencode-go")
    expect(fourth?.model).toBe("glm-5.2")
    expect(fifth?.providers[0]).toBe("kimi-for-coding")
    expect(fifth?.model).toBe("k2p5")
  })

  test("quick keeps gpt-5.4-mini primary before claude-haiku-4-5", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const [primary, secondary] = quick.fallbackChain

    // then
    expect(quick.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe("gpt-5.4-mini")
    expect(primary?.providers).toContain("openai")
    expect(secondary?.model).toBe("claude-haiku-4-5")
    expect(secondary?.providers).toContain("anthropic")
  })

  test("unspecified-low keeps native gpt-5.6-luna xhigh before Copilot high", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const [primary, copilot, legacyFallback] = unspecifiedLow.fallbackChain

    // then
    expect(unspecifiedLow.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe("gpt-5.6-luna")
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.providers[0]).toBe("openai")
    expect(copilot).toEqual({
      providers: ["github-copilot"],
      model: "gpt-5.6-luna",
      variant: "high",
    })
    expect(legacyFallback?.model).toBe("claude-sonnet-4-6")
    expect(legacyFallback?.providers[0]).toBe("anthropic")
  })

  test("unspecified-high keeps opus primary before gpt-5.5 high", () => {
    // given
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const [primary, secondary] = unspecifiedHigh.fallbackChain

    // then
    expect(unspecifiedHigh.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: ["anthropic", "github-copilot", "opencode", "vercel"],
      model: "claude-opus-4-8",
      variant: "max",
    })
    expect(secondary).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "high",
    })
  })

  test("artistry has gemini-3.1-pro high as primary", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const primary = artistry.fallbackChain[0]

    // then
    expect(artistry.fallbackChain.length).toBeGreaterThan(0)
    expect(primary?.model).toBe("gemini-3.1-pro")
    expect(primary?.variant).toBe("high")
    expect(primary?.providers[0]).toBe("google")
  })

  test("writing keeps gemini, kimi, sonnet, and minimax fallback order", () => {
    // given
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const [primary, second, third, fourth, fifth, sixth] = writing.fallbackChain

    // then
    expect(writing.fallbackChain).toHaveLength(6)
    expect(primary?.model).toBe("gemini-3-flash")
    expect(primary?.providers[0]).toBe("google")
    expect(second?.model).toBe("kimi-k2.6")
    expect(second?.providers[0]).toBe("opencode-go")
    expect(third?.model).toBe("claude-sonnet-4-6")
    expect(third?.providers[0]).toBe("anthropic")
    expect(fourth?.model).toBe("minimax-m3")
    expect(fourth?.providers[0]).toBe("opencode-go")
    expect(fifth).toEqual({
      providers: ["minimax-coding-plan", "minimax-cn-coding-plan"],
      model: "MiniMax-M3",
    })
    expect(sixth?.model).toBe("minimax-m2.7")
    expect(sixth?.providers[0]).toBe("opencode-go")
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
