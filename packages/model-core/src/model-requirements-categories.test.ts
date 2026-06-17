import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "./registry";
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
    expect(primary?.model).toBe(SUPPORTED_MODELS.GPT_5_6_SOL)
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENAI)
    expect(secondary?.model).toBe(SUPPORTED_MODELS.GPT_5_5)
    expect(secondary?.variant).toBe(SUPPORTED_VARIANTS.XHIGH)
  })

  test("deep has gpt-5.6-terra xhigh as primary before gpt-5.6-sol high", () => {
    // given
    const deep = CATEGORY_MODEL_REQUIREMENTS["deep"]

    // when
    const [primary, secondary, third] = deep.fallbackChain

    // then
    expect(deep.fallbackChain.length).toBeGreaterThan(2)
    expect(primary?.variant).toBe(SUPPORTED_VARIANTS.XHIGH)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GPT_5_6_TERRA)
    expect(primary?.providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
    expect(primary?.providers).not.toContain(SUPPORTED_PROVIDERS.VENICE)
    expect(secondary?.model).toBe(SUPPORTED_MODELS.GPT_5_6_SOL)
    expect(secondary?.variant).toBe(SUPPORTED_VARIANTS.HIGH)
    expect(third?.model).toBe(SUPPORTED_MODELS.GPT_5_5)
    expect(third?.variant).toBe(SUPPORTED_VARIANTS.MEDIUM)
    expect(third?.providers).toContain(SUPPORTED_PROVIDERS.GITHUB_COPILOT)
  })

  test("visual-engineering keeps gemini, glm, opus, opencode-go, and k2p5 fallback order", () => {
    // given
    const visualEngineering = CATEGORY_MODEL_REQUIREMENTS["visual-engineering"]

    // when
    const [primary, second, third, fourth, fifth] = visualEngineering.fallbackChain

    // then
    expect(visualEngineering.fallbackChain).toHaveLength(5)
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.GOOGLE)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GEMINI_3_1_PRO)
    expect(primary?.variant).toBe("high")
    expect(second?.providers[0]).toBe(SUPPORTED_PROVIDERS.ZAI_CODING_PLAN)
    expect(second?.model).toBe(SUPPORTED_MODELS.GLM_5)
    expect(third?.model).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    expect(third?.variant).toBe("max")
    expect(fourth?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(fourth?.model).toBe(SUPPORTED_MODELS.GLM_5_2)
    expect(fifth?.providers[0]).toBe(SUPPORTED_PROVIDERS.KIMI_FOR_CODING)
    expect(fifth?.model).toBe(SUPPORTED_MODELS.KIMI_K2P5)
  })

  test("quick keeps gpt-5.4-mini primary before claude-haiku-4-5", () => {
    // given
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"]

    // when
    const [primary, secondary] = quick.fallbackChain

    // then
    expect(quick.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GPT_5_4_MINI)
    expect(primary?.providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
    expect(secondary?.model).toBe(SUPPORTED_MODELS.CLAUDE_HAIKU_4_5)
    expect(secondary?.providers).toContain(SUPPORTED_PROVIDERS.ANTHROPIC)
  })

  test("unspecified-low has gpt-5.6-luna xhigh as primary before claude-sonnet-4-6", () => {
    // given
    const unspecifiedLow = CATEGORY_MODEL_REQUIREMENTS["unspecified-low"]

    // when
    const [primary, secondary] = unspecifiedLow.fallbackChain

    // then
    expect(unspecifiedLow.fallbackChain.length).toBeGreaterThan(1)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GPT_5_6_LUNA)
    expect(primary?.variant).toBe(SUPPORTED_VARIANTS.XHIGH)
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENAI)
    expect(secondary?.model).toBe(SUPPORTED_MODELS.CLAUDE_SONNET_4_6)
    expect(secondary?.providers[0]).toBe(SUPPORTED_PROVIDERS.ANTHROPIC)
  })

  test("unspecified-high keeps opus primary before gpt-5.5 high", () => {
    // given
    const unspecifiedHigh = CATEGORY_MODEL_REQUIREMENTS["unspecified-high"]

    // when
    const [primary, secondary] = unspecifiedHigh.fallbackChain

    // then
    expect(unspecifiedHigh.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode", SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      variant: SUPPORTED_VARIANTS.MAX,
    })
    expect(secondary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode", SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  test("artistry has gemini-3.1-pro high as primary", () => {
    // given
    const artistry = CATEGORY_MODEL_REQUIREMENTS["artistry"]

    // when
    const primary = artistry.fallbackChain[0]

    // then
    expect(artistry.fallbackChain.length).toBeGreaterThan(0)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GEMINI_3_1_PRO)
    expect(primary?.variant).toBe("high")
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.GOOGLE)
  })

  test("writing keeps gemini, kimi, sonnet, and minimax fallback order", () => {
    // given
    const writing = CATEGORY_MODEL_REQUIREMENTS["writing"]

    // when
    const [primary, second, third, fourth, fifth, sixth] = writing.fallbackChain

    // then
    expect(writing.fallbackChain).toHaveLength(6)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GEMINI_3_FLASH)
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.GOOGLE)
    expect(second?.model).toBe(SUPPORTED_MODELS.KIMI_K2_6)
    expect(second?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(third?.model).toBe(SUPPORTED_MODELS.CLAUDE_SONNET_4_6)
    expect(third?.providers[0]).toBe(SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(fourth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M3)
    expect(fourth?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(fifth).toEqual({
      providers: [SUPPORTED_PROVIDERS.MINIMAX_CODING_PLAN, SUPPORTED_PROVIDERS.MINIMAX_CN_CODING_PLAN],
      model: SUPPORTED_MODELS.MINIMAX_M3_CAP,
    })
    expect(sixth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M2_7)
    expect(sixth?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
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
