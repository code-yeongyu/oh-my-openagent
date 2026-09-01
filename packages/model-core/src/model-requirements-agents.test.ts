import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("oracle has gpt-5.6-sol xhigh as primary", () => {
    // given
    const oracle = AGENT_MODEL_REQUIREMENTS["oracle"]

    // when
    const primary = oracle.fallbackChain[0]

    // then
    expect(oracle.fallbackChain).toBeArray()
    expect(oracle.fallbackChain.length).toBeGreaterThan(0)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex", "opencode"],
          model: "gpt-5.6-sol",
          variant: "xhigh",
        })
    expect(oracle.fallbackChain[1]).toEqual({
          providers: ["github-copilot"],
          model: "gpt-5.6-sol",
          variant: "high",
        })
  })

  test("sisyphus keeps opus primary before Kimi K3, gpt-5.6-sol, GLM 5.2, and big-pickle fallbacks", () => {
    // given
    const sisyphus = AGENT_MODEL_REQUIREMENTS["sisyphus"]

    // when
    const [primary, second, solFallback, fourth, last] = sisyphus.fallbackChain

    // then
    expect(sisyphus.fallbackChain).toHaveLength(5)
    expect(sisyphus.requiresAnyModel).toBe(true)
    expect(primary).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5",
          variant: "max",
        })
    expect(second).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
          model: "kimi-k3",
        })
    expect(solFallback).toEqual({
          providers: ["openai", "openai-codex", "github-copilot", "opencode"],
          model: "gpt-5.6-sol",
          variant: "medium",
        })
    expect(fourth?.providers[0]).toBe("zai-coding-plan")
    expect(fourth?.model).toBe("glm-5.2")
    expect(last?.providers[0]).toBe("opencode")
    expect(last?.model).toBe("big-pickle")
  })

  test("librarian keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const librarian = AGENT_MODEL_REQUIREMENTS["librarian"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] = librarian.fallbackChain

    // then
    expect(librarian.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex"],
          model: "gpt-5.6-luna-fast",
          variant: "low",
        })
    expect(second?.providers).toContain("deepseek")
    expect(second?.model).toBe("deepseek-v4-flash")
    expect(third?.providers).toContain("opencode-go")
    expect(third?.providers).toContain("bailian-coding-plan")
    expect(third?.model).toBe("qwen3.7-plus")
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
    expect(eighth).toEqual({
          providers: ["openai", "openai-codex"],
          model: "gpt-5.4-nano",
        })
  })

  test("explore keeps fast OpenAI primary before qwen, minimax, haiku, and nano fallbacks", () => {
    // given
    const explore = AGENT_MODEL_REQUIREMENTS["explore"]

    // when
    const [primary, second, third, fourth, fifth, sixth, seventh, eighth] = explore.fallbackChain

    // then
    expect(explore.fallbackChain).toHaveLength(8)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex"],
          model: "gpt-5.6-luna-fast",
          variant: "low",
        })
    expect(second?.providers).toContain("deepseek")
    expect(second?.model).toBe("deepseek-v4-flash")
    expect(third?.providers).toContain("opencode-go")
    expect(third?.providers).toContain("bailian-coding-plan")
    expect(third?.model).toBe("qwen3.7-plus")
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
    expect(eighth).toEqual({
          providers: ["openai", "openai-codex"],
          model: "gpt-5.4-nano",
        })
  })

  test("multimodal-looker keeps vision-capable fallback order", () => {
    // given
    const multimodalLooker = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

    // when
    const [primary, secondary, tertiary, last] = multimodalLooker.fallbackChain

    // then
    expect(multimodalLooker.fallbackChain).toHaveLength(4)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex", "opencode"],
          model: "gpt-5.6-sol",
          variant: "low",
        })
    expect(secondary).toEqual({
          providers: ["opencode-go"],
          model: "kimi-k3",
        })
    expect(tertiary?.model).toBe("glm-4.6v")
    expect(last).toEqual({
          providers: ["openai", "openai-codex", "github-copilot", "opencode"],
          model: "gpt-5-nano",
        })
  })

  test("prometheus uses Fable 5 xhigh before Kimi K3 max", () => {
    // given
    const prometheus = AGENT_MODEL_REQUIREMENTS["prometheus"]

    // when
    const [primary, kimiFallback] = prometheus.fallbackChain

    // then
    expect(prometheus.fallbackChain).toHaveLength(2)
    expect(primary).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-fable-5",
          variant: "xhigh",
        })
    expect(kimiFallback).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
          model: "kimi-k3",
          variant: "max",
        })
  })

  test("metis uses Opus 5 high before Kimi K3 low", () => {
    // given
    const metis = AGENT_MODEL_REQUIREMENTS["metis"]

    // when
    const [primary, kimiFallback] = metis.fallbackChain

    // then
    expect(metis.fallbackChain).toHaveLength(2)
    expect(primary).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5",
          variant: "high",
        })
    expect(kimiFallback).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
          model: "kimi-k3",
          variant: "low",
        })
  })

  test("momus keeps native gpt-5.6-terra high before gpt-5.6-sol xhigh", () => {
    // given
    const momus = AGENT_MODEL_REQUIREMENTS["momus"]

    // when
    const [primary, copilot, solFallback, copilotSolFallback, opusFallback] = momus.fallbackChain

    // then
    expect(momus.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex"],
          model: "gpt-5.6-terra",
          variant: "high",
        })
    expect(copilot).toEqual({
          providers: ["github-copilot"],
          model: "gpt-5.6-terra",
          variant: "high",
        })
    expect(solFallback).toEqual({
          providers: ["openai", "openai-codex", "opencode"],
          model: "gpt-5.6-sol",
          variant: "xhigh",
        })
    expect(copilotSolFallback).toEqual({
          providers: ["github-copilot"],
          model: "gpt-5.6-sol",
          variant: "high",
        })
    expect(opusFallback).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5",
          variant: "max",
        })
  })

  test("atlas keeps sonnet, kimi, gpt-5.6-sol, and minimax fallback order", () => {
    // given
    const atlas = AGENT_MODEL_REQUIREMENTS["atlas"]

    // when
    const [primary, secondary, solFallback, fourth, fifth, sixth] = atlas.fallbackChain

    // then
    expect(atlas.fallbackChain).toHaveLength(6)
    expect(primary?.model).toBe("claude-sonnet-5")
    expect(primary?.providers[0]).toBe("anthropic")
    expect(secondary?.model).toBe("kimi-k3")
    expect(secondary?.providers[0]).toBe("opencode-go")
    expect(solFallback).toEqual({
          providers: ["openai", "openai-codex", "github-copilot", "opencode"],
          model: "gpt-5.6-sol",
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

  test("sisyphus-junior keeps sonnet, Kimi, minimax, and big-pickle fallbacks", () => {
    // given
    const sisyphusJunior = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"]

    // when
    const modelIDs = sisyphusJunior.fallbackChain.map((entry) => entry.model)

    // then
    expect(modelIDs).toEqual([
      "claude-sonnet-5",
      "kimi-k3",
      "gpt-5.6-sol",
      "minimax-m3",
      "MiniMax-M3",
      "minimax-m2.7",
      "big-pickle",
    ])
    expect(modelIDs).not.toContain("gpt-5.5")
  })

  test("hephaestus supports openai, openai-codex, github-copilot, and opencode providers", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when / then
    expect(hephaestus.requiresProvider).toEqual([
      "openai",
      "openai-codex",
      "github-copilot",
      "opencode",
    ])
    expect(hephaestus.requiresProvider).not.toContain("venice")
    expect(hephaestus.fallbackChain[0]?.providers).not.toContain("venice")
    expect(hephaestus.requiresModel).toBeUndefined()
    expect(hephaestus.requiresAnyModel).toBe(true)
  })

  test("hephaestus has one merged gpt-5.6-sol medium rung", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when
    const [primary] = hephaestus.fallbackChain

    // then
    expect(hephaestus.fallbackChain).toHaveLength(1)
    expect(primary).toEqual({
          providers: ["openai", "openai-codex", "github-copilot", "opencode"],
          model: "gpt-5.6-sol",
          variant: "medium",
        })
  })

})
