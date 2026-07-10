import { describe, expect, test } from "bun:test"
import { CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("ultrabrain has gpt-5.6-sol xhigh as primary before gpt-5.5 xhigh", () => {
    // given
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]

    // when
    const [primary, secondary] = ultrabrain.fallbackChain

    // then
    expect(ultrabrain.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.model).toBe("gpt-5.6-sol")
    expect(primary?.providers[0]).toBe("openai")
    expect(secondary?.model).toBe("gpt-5.5")
    expect(secondary?.variant).toBe("xhigh")
  })

  test("deep has gpt-5.6-terra xhigh as primary before gpt-5.6-sol high", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const [primary, secondary, third] = deep.fallbackChain

    // then
    expect(deep.fallbackChain.length).toBeGreaterThan(2)
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.model).toBe("gpt-5.6-terra")
    expect(primary?.providers).toContain("openai")
    expect(primary?.providers).not.toContain("venice")
    expect(secondary?.model).toBe("gpt-5.6-sol")
    expect(secondary?.variant).toBe("high")
    expect(third?.model).toBe("gpt-5.5")
    expect(third?.variant).toBe("medium")
    expect(third?.providers).toContain("github-copilot")
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
    expect(third?.model).toBe("claude-opus-4-7")
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

  test("unspecified-low has gpt-5.6-luna xhigh as primary before claude-sonnet-4-6", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const [primary, secondary] = unspecifiedLow.fallbackChain

    // then
    expect(unspecifiedLow.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe("gpt-5.6-luna")
    expect(primary?.variant).toBe("xhigh")
    expect(primary?.providers[0]).toBe("openai")
    expect(secondary?.model).toBe("claude-sonnet-4-6")
    expect(secondary?.providers[0]).toBe("anthropic")
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
      model: "claude-opus-4-7",
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
