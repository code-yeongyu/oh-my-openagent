import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "./registry";
import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("oracle has valid fallbackChain with gpt-5.5 as primary", () => {
    // given
    const oracle = AGENT_MODEL_REQUIREMENTS["oracle"]

    // when
    const primary = oracle.fallbackChain[0]

    // then
    expect(oracle.fallbackChain).toBeArray()
    expect(oracle.fallbackChain.length).toBeGreaterThan(0)
    expect(primary?.providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
    expect(primary?.model).toBe(SUPPORTED_MODELS.GPT_5_5)
    expect(primary?.variant).toBe(SUPPORTED_VARIANTS.HIGH)
  })

  test("sisyphus keeps opus primary before k2p5, kimi-k2.5, gpt-5.5 medium, and big-pickle", () => {
    // given
    const sisyphus = AGENT_MODEL_REQUIREMENTS["sisyphus"]

    // when
    const [primary, second, third, fourth, fifth, sixth, last] = sisyphus.fallbackChain

    // then
    expect(sisyphus.fallbackChain).toHaveLength(7)
    expect(sisyphus.requiresAnyModel).toBe(true)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      variant: SUPPORTED_VARIANTS.MAX,
    })
    expect(second).toEqual({ providers: [SUPPORTED_PROVIDERS.OPENCODE_GO, SUPPORTED_PROVIDERS.VERCEL], model: SUPPORTED_MODELS.KIMI_K2_6 })
    expect(third).toEqual({ providers: [SUPPORTED_PROVIDERS.KIMI_FOR_CODING], model: SUPPORTED_MODELS.KIMI_K2P5 })
    expect(fourth?.model).toBe(SUPPORTED_MODELS.KIMI_K2_5)
    expect(fifth).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
    expect(sixth?.providers[0]).toBe(SUPPORTED_PROVIDERS.ZAI_CODING_PLAN)
    expect(sixth?.model).toBe(SUPPORTED_MODELS.GLM_5)
    expect(last?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE)
    expect(last?.model).toBe(SUPPORTED_MODELS.BIG_PICKLE)
  })

  test("librarian keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const librarian = AGENT_MODEL_REQUIREMENTS["librarian"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] =
      librarian.fallbackChain

    // then
    expect(librarian.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4_MINI_FAST })
    expect(second?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(second?.providers).toContain(SUPPORTED_PROVIDERS.BAILIAN_CODING_PLAN)
    expect(second?.model).toBe(SUPPORTED_MODELS.QWEN_3_5_PLUS)
    expect(third).toEqual({ providers: [SUPPORTED_PROVIDERS.VERCEL], model: SUPPORTED_MODELS.MINIMAX_M2_7_HIGHSPEED })
    expect(fourth?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(fourth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M3)
    expect(fifth).toEqual({
      providers: [SUPPORTED_PROVIDERS.MINIMAX_CODING_PLAN, SUPPORTED_PROVIDERS.MINIMAX_CN_CODING_PLAN],
      model: SUPPORTED_MODELS.MINIMAX_M3_NATIVE,
    })
    expect(sixth?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(sixth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M2_7)
    expect(seventh?.providers).toContain(SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(seventh?.model).toBe(SUPPORTED_MODELS.CLAUDE_HAIKU_4_5)
    expect(eighth?.providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
    expect(eighth?.model).toBe(SUPPORTED_MODELS.GPT_5_4_NANO)
  })

  test("explore keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const explore = AGENT_MODEL_REQUIREMENTS["explore"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] = explore.fallbackChain

    // then
    expect(explore.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({ providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4_MINI_FAST })
    expect(second?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(second?.providers).toContain(SUPPORTED_PROVIDERS.BAILIAN_CODING_PLAN)
    expect(second?.model).toBe(SUPPORTED_MODELS.QWEN_3_5_PLUS)
    expect(third).toEqual({ providers: [SUPPORTED_PROVIDERS.VERCEL], model: SUPPORTED_MODELS.MINIMAX_M2_7_HIGHSPEED })
    expect(fourth?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(fourth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M3)
    expect(fifth).toEqual({
      providers: [SUPPORTED_PROVIDERS.MINIMAX_CODING_PLAN, SUPPORTED_PROVIDERS.MINIMAX_CN_CODING_PLAN],
      model: SUPPORTED_MODELS.MINIMAX_M3_NATIVE,
    })
    expect(sixth?.providers).toContain(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(sixth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M2_7)
    expect(seventh?.providers).toContain(SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(seventh?.model).toBe(SUPPORTED_MODELS.CLAUDE_HAIKU_4_5)
    expect(eighth?.providers).toContain(SUPPORTED_PROVIDERS.OPENAI)
    expect(eighth?.model).toBe(SUPPORTED_MODELS.GPT_5_4_NANO)
  })

  test("multimodal-looker keeps vision-capable fallback order", () => {
    // given
    const multimodalLooker = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

    // when
    const [primary, secondary, tertiary, last] = multimodalLooker.fallbackChain

    // then
    expect(multimodalLooker.fallbackChain).toHaveLength(4)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
    expect(secondary).toEqual({ providers: [SUPPORTED_PROVIDERS.OPENCODE_GO, SUPPORTED_PROVIDERS.VERCEL], model: SUPPORTED_MODELS.KIMI_K2_6 })
    expect(tertiary?.model).toBe(SUPPORTED_MODELS.GLM_4_6V)
    expect(last).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_NANO,
    })
  })

  test("prometheus has claude-opus-4-7 as primary", () => {
    // given
    const prometheus = AGENT_MODEL_REQUIREMENTS["prometheus"]

    // when
    const primary = prometheus.fallbackChain[0]

    // then
    expect(prometheus.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
      variant: SUPPORTED_VARIANTS.MAX,
    })
  })

  test("metis has sonnet primary, opus fallback, and OpenAI high fallback", () => {
    // given
    const metis = AGENT_MODEL_REQUIREMENTS["metis"]

    // when
    const primary = metis.fallbackChain[0]
    const opusFallback = metis.fallbackChain[1]
    const openAiFallback = metis.fallbackChain.find((entry) => entry.providers.includes(SUPPORTED_PROVIDERS.OPENAI))

    // then
    expect(metis.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
    })
    expect(opusFallback?.model).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    expect(opusFallback?.variant).toBe(SUPPORTED_VARIANTS.MAX)
    expect(openAiFallback).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.HIGH,
    })
  })

  test("momus has gpt-5.6-sol ultra as primary before gpt-5.5 xhigh", () => {
    // given
    const momus = AGENT_MODEL_REQUIREMENTS["momus"]

    // when
    const [primary, secondary] = momus.fallbackChain

    // then
    expect(momus.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_6_SOL,
      variant: SUPPORTED_VARIANTS.ULTRA,
    })
    expect(secondary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.XHIGH,
    })
  })

  test("atlas keeps sonnet, kimi, gpt-5.5, and minimax fallback order", () => {
    // given
    const atlas = AGENT_MODEL_REQUIREMENTS["atlas"]

    // when
    const [primary, secondary, tertiary, fourth, fifth, sixth] = atlas.fallbackChain

    // then
    expect(atlas.fallbackChain).toHaveLength(6)
    expect(primary?.model).toBe(SUPPORTED_MODELS.CLAUDE_SONNET_4_6)
    expect(primary?.providers[0]).toBe(SUPPORTED_PROVIDERS.ANTHROPIC)
    expect(secondary?.model).toBe(SUPPORTED_MODELS.KIMI_K2_6)
    expect(secondary?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(tertiary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
    expect(fourth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M3)
    expect(fourth?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
    expect(fifth).toEqual({
      providers: [SUPPORTED_PROVIDERS.MINIMAX_CODING_PLAN, SUPPORTED_PROVIDERS.MINIMAX_CN_CODING_PLAN],
      model: SUPPORTED_MODELS.MINIMAX_M3_NATIVE,
    })
    expect(sixth?.model).toBe(SUPPORTED_MODELS.MINIMAX_M2_7)
    expect(sixth?.providers[0]).toBe(SUPPORTED_PROVIDERS.OPENCODE_GO)
  })

  test("sisyphus-junior keeps OpenAI fallback before minimax and big-pickle", () => {
    // given
    const sisyphusJunior = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"]

    // when
    const openAiFallback = sisyphusJunior.fallbackChain.find((entry) =>
      entry.providers.includes(SUPPORTED_PROVIDERS.OPENAI)
    )
    const openAiFallbackIndex = sisyphusJunior.fallbackChain.findIndex((entry) =>
      entry.providers.includes(SUPPORTED_PROVIDERS.OPENAI)
    )
    const minimaxM3Index = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === SUPPORTED_MODELS.MINIMAX_M3
    )
    const minimaxCodingPlanIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === SUPPORTED_MODELS.MINIMAX_M3_NATIVE
    )
    const minimaxIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === SUPPORTED_MODELS.MINIMAX_M2_7
    )
    const bigPickleIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === SUPPORTED_MODELS.BIG_PICKLE
    )

    // then
    expect(openAiFallback).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
    expect(openAiFallbackIndex).toBeGreaterThan(-1)
    expect(minimaxM3Index).toBeGreaterThan(openAiFallbackIndex)
    expect(minimaxCodingPlanIndex).toBeGreaterThan(minimaxM3Index)
    expect(minimaxIndex).toBeGreaterThan(minimaxCodingPlanIndex)
    expect(bigPickleIndex).toBeGreaterThan(minimaxIndex)
  })

  test("hephaestus supports openai, github-copilot, opencode, and vercel providers", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when / then
    expect(hephaestus.requiresProvider).toEqual([
      SUPPORTED_PROVIDERS.OPENAI,
      SUPPORTED_PROVIDERS.GITHUB_COPILOT,
      SUPPORTED_PROVIDERS.OPENCODE,
      SUPPORTED_PROVIDERS.VERCEL,
    ])
    expect(hephaestus.requiresProvider).not.toContain("venice")
    expect(hephaestus.fallbackChain[0]?.providers).not.toContain("venice")
    expect(hephaestus.requiresModel).toBeUndefined()
    expect(hephaestus.requiresAnyModel).toBe(true)
  })

  test("hephaestus has gpt-5.6-sol medium as primary before gpt-5.5 medium", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when
    const [primary, secondary] = hephaestus.fallbackChain

    // then
    expect(primary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_6_SOL,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
    expect(secondary).toEqual({
      providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, SUPPORTED_PROVIDERS.OPENCODE, SUPPORTED_PROVIDERS.VERCEL],
      model: SUPPORTED_MODELS.GPT_5_5,
      variant: SUPPORTED_VARIANTS.MEDIUM,
    })
  })
})
