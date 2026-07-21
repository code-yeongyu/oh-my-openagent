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

  test("deep keeps native gpt-5.6-terra xhigh before Copilot terra high and shared sol high", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const [primary, copilot, sharedSol, mediumSol, opusFallback] = deep.fallbackChain

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
    expect(mediumSol).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "medium",
    })
    expect(opusFallback?.model).toBe("claude-opus-4-8")
    expect(opusFallback?.variant).toBe("max")
  })

  test("visual-engineering keeps gemini, glm, opus, opencode-go, and Kimi K3 fallback order", () => {
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
    expect(fifth?.model).toBe("kimi-k3")
  })

  test("quick keeps gpt-5.4-mini primary before haiku and Gemini 3.6 Flash", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const [primary, secondary, geminiFallback] = quick.fallbackChain

    // then
    expect(quick.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe("gpt-5.4-mini")
    expect(primary?.providers).toContain("openai")
    expect(secondary?.model).toBe("claude-haiku-4-5")
    expect(secondary?.providers).toContain("anthropic")
    expect(geminiFallback).toEqual({
      providers: ["google", "opencode", "vercel"],
      model: "gemini-3.6-flash",
    })
  })

  test("unspecified-low keeps native gpt-5.6-luna xhigh before Copilot high and Gemini 3.6 Flash", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const [primary, copilot, claudeFallback, solFallback, kimiFallback, geminiFallback] = unspecifiedLow.fallbackChain

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
    expect(claudeFallback?.model).toBe("claude-sonnet-4-6")
    expect(claudeFallback?.providers[0]).toBe("anthropic")
    expect(solFallback).toEqual({
      providers: ["openai", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "medium",
    })
    expect(kimiFallback?.model).toBe("kimi-k3")
    expect(geminiFallback).toEqual({
      providers: ["google", "opencode", "vercel"],
      model: "gemini-3.6-flash",
    })
  })

  test("unspecified-high keeps opus primary before gpt-5.6-sol high", () => {
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
      model: "gpt-5.6-sol",
      variant: "high",
    })
  })

  test("artistry keeps gemini-3.1-pro high primary and gpt-5.6-sol OpenAI coverage", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const primary = artistry.fallbackChain[0]
    const openAiFallback = artistry.fallbackChain.find((entry) => entry.providers.includes("openai"))

    // then
    expect(artistry.fallbackChain.length).toBeGreaterThan(0)
    expect(primary?.model).toBe("gemini-3.1-pro")
    expect(primary?.variant).toBe("high")
    expect(primary?.providers[0]).toBe("google")
    expect(openAiFallback).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
  })

  test("writing keeps gemini, kimi, sonnet, and minimax fallback order", () => {
    // given
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const [primary, second, third, fourth, fifth, sixth] = writing.fallbackChain

    // then
    expect(writing.fallbackChain).toHaveLength(6)
    expect(primary).toEqual({
      providers: ["google", "opencode", "vercel"],
      model: "gemini-3.6-flash",
    })
    expect(second?.model).toBe("kimi-k3")
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
