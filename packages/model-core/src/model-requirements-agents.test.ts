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
    expect(primary?.providers).toContain("openai")
    expect(primary?.model).toBe("gpt-5.5")
    expect(primary?.variant).toBe("high")
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
      providers: ["anthropic", "github-copilot", "opencode", "vercel"],
      model: "claude-opus-4-7",
      variant: "max",
    })
    expect(second).toEqual({ providers: ["opencode-go", "vercel"], model: "kimi-k2.6" })
    expect(third).toEqual({ providers: ["kimi-for-coding"], model: "k2p5" })
    expect(fourth?.model).toBe("kimi-k2.5")
    expect(fifth).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
    })
    expect(sixth?.providers[0]).toBe("zai-coding-plan")
    expect(sixth?.model).toBe("glm-5")
    expect(last?.providers[0]).toBe("opencode")
    expect(last?.model).toBe("big-pickle")
  })

  test("librarian keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const librarian = AGENT_MODEL_REQUIREMENTS["librarian"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] =
      librarian.fallbackChain

    // then
    expect(librarian.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({ providers: ["openai"], model: "gpt-5.4-mini-fast" })
    expect(second?.providers).toContain("opencode-go")
    expect(second?.providers).toContain("bailian-coding-plan")
    expect(second?.model).toBe("qwen3.5-plus")
    expect(third).toEqual({ providers: ["vercel"], model: "minimax-m2.7-highspeed" })
    expect(fourth?.providers).toContain("opencode-go")
    expect(fourth?.model).toBe("minimax-m3")
    expect(fifth).toEqual({
      providers: ["minimax-coding-plan", "minimax-cn-coding-plan"],
      model: "MiniMax-M3",
    })
    expect(sixth?.providers).toContain("opencode-go")
    expect(sixth?.model).toBe("minimax-m2.7")
    expect(seventh?.providers).toContain("anthropic")
    expect(seventh?.model).toBe("claude-haiku-4-5")
    expect(eighth?.providers).toContain("openai")
    expect(eighth?.model).toBe("gpt-5.4-nano")
  })

  test("explore keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const explore = AGENT_MODEL_REQUIREMENTS["explore"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] = explore.fallbackChain

    // then
    expect(explore.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({ providers: ["openai"], model: "gpt-5.4-mini-fast" })
    expect(second?.providers).toContain("opencode-go")
    expect(second?.providers).toContain("bailian-coding-plan")
    expect(second?.model).toBe("qwen3.5-plus")
    expect(third).toEqual({ providers: ["vercel"], model: "minimax-m2.7-highspeed" })
    expect(fourth?.providers).toContain("opencode-go")
    expect(fourth?.model).toBe("minimax-m3")
    expect(fifth).toEqual({
      providers: ["minimax-coding-plan", "minimax-cn-coding-plan"],
      model: "MiniMax-M3",
    })
    expect(sixth?.providers).toContain("opencode-go")
    expect(sixth?.model).toBe("minimax-m2.7")
    expect(seventh?.providers).toContain("anthropic")
    expect(seventh?.model).toBe("claude-haiku-4-5")
    expect(eighth?.providers).toContain("openai")
    expect(eighth?.model).toBe("gpt-5.4-nano")
  })

  test("multimodal-looker keeps vision-capable fallback order", () => {
    // given
    const multimodalLooker = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

    // when
    const [primary, secondary, tertiary, last] = multimodalLooker.fallbackChain

    // then
    expect(multimodalLooker.fallbackChain).toHaveLength(4)
    expect(primary).toEqual({
      providers: ["openai", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
    })
    expect(secondary).toEqual({ providers: ["opencode-go", "vercel"], model: "kimi-k2.6" })
    expect(tertiary?.model).toBe("glm-4.6v")
    expect(last).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5-nano",
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
      providers: ["anthropic", "github-copilot", "opencode", "vercel"],
      model: "claude-opus-4-7",
      variant: "max",
    })
  })

  test("metis has sonnet primary, opus fallback, and OpenAI high fallback", () => {
    // given
    const metis = AGENT_MODEL_REQUIREMENTS["metis"]

    // when
    const primary = metis.fallbackChain[0]
    const opusFallback = metis.fallbackChain[1]
    const openAiFallback = metis.fallbackChain.find((entry) => entry.providers.includes("openai"))

    // then
    expect(metis.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: ["anthropic", "github-copilot", "opencode", "vercel"],
      model: "claude-sonnet-4-6",
    })
    expect(opusFallback?.model).toBe("claude-opus-4-7")
    expect(opusFallback?.variant).toBe("max")
    expect(openAiFallback).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "high",
    })
  })

  test("momus keeps native gpt-5.6-sol xhigh before Copilot high and gpt-5.5", () => {
    // given
    const momus = AGENT_MODEL_REQUIREMENTS["momus"]

    // when
    const [primary, copilot, legacyFallback] = momus.fallbackChain

    // then
    expect(momus.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
      providers: ["openai", "vercel"],
      model: "gpt-5.6-sol",
      variant: "xhigh",
    })
    expect(copilot).toEqual({
      providers: ["github-copilot"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
    expect(legacyFallback).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "xhigh",
    })
  })

  test("atlas keeps sonnet, kimi, gpt-5.5, and minimax fallback order", () => {
    // given
    const atlas = AGENT_MODEL_REQUIREMENTS["atlas"]

    // when
    const [primary, secondary, tertiary, fourth, fifth, sixth] = atlas.fallbackChain

    // then
    expect(atlas.fallbackChain).toHaveLength(6)
    expect(primary?.model).toBe("claude-sonnet-4-6")
    expect(primary?.providers[0]).toBe("anthropic")
    expect(secondary?.model).toBe("kimi-k2.6")
    expect(secondary?.providers[0]).toBe("opencode-go")
    expect(tertiary).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
    })
    expect(fourth?.model).toBe("minimax-m3")
    expect(fourth?.providers[0]).toBe("opencode-go")
    expect(fifth).toEqual({
      providers: ["minimax-coding-plan", "minimax-cn-coding-plan"],
      model: "MiniMax-M3",
    })
    expect(sixth?.model).toBe("minimax-m2.7")
    expect(sixth?.providers[0]).toBe("opencode-go")
  })

  test("sisyphus-junior keeps OpenAI fallback before minimax and big-pickle", () => {
    // given
    const sisyphusJunior = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"]

    // when
    const openAiFallback = sisyphusJunior.fallbackChain.find((entry) =>
      entry.providers.includes("openai")
    )
    const openAiFallbackIndex = sisyphusJunior.fallbackChain.findIndex((entry) =>
      entry.providers.includes("openai")
    )
    const minimaxM3Index = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === "minimax-m3"
    )
    const minimaxCodingPlanIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === "MiniMax-M3"
    )
    const minimaxIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === "minimax-m2.7"
    )
    const bigPickleIndex = sisyphusJunior.fallbackChain.findIndex(
      (entry) => entry.model === "big-pickle"
    )

    // then
    expect(openAiFallback).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
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
      "openai",
      "github-copilot",
      "opencode",
      "vercel",
    ])
    expect(hephaestus.requiresProvider).not.toContain("venice")
    expect(hephaestus.fallbackChain[0]?.providers).not.toContain("venice")
    expect(hephaestus.requiresModel).toBeUndefined()
    expect(hephaestus.requiresAnyModel).toBe(true)
  })

  test("hephaestus has gpt-5.6-sol high as primary before gpt-5.5 medium", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when
    const [primary, secondary] = hephaestus.fallbackChain

    // then
    expect(primary).toEqual({
      providers: ["openai", "github-copilot", "vercel"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
    expect(secondary).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "medium",
    })
  })
})
