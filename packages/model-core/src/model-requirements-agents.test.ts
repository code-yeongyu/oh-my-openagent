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
          providers: ["openai", "chatgpt-subscription", "opencode"],
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
          model: "claude-opus-5-5",
          variant: "max",
        })
    expect(second).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode", "bailian-coding-plan", "moonshotai-cn", "firmware", "ollama-cloud", "aihubmix"],
          model: "kimi-k3",
        })
    expect(solFallback).toEqual({
          providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
          model: "gpt-5.6-sol",
          variant: "medium",
        })
    expect(fourth?.providers[0]).toBe("zai-coding-plan")
    expect(fourth?.model).toBe("glm-5.2")
    expect(last?.providers[0]).toBe("opencode")
    expect(last?.model).toBe("big-pickle")
  })

  for (const agent of ["librarian", "explore"] as const) {
    test(`${agent} runs no-thinking Kimi HighSpeed, Luna Fast, DeepSeek V4.1 Flash, Qwen 3.7 Plus, M2.7, then Haiku`, () => {
      // given
      const requirement = AGENT_MODEL_REQUIREMENTS[agent]

      // then
      expect(requirement.fallbackChain).toEqual([
        { providers: ["kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
        { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
      ])
    })
  }

  test("multimodal-looker keeps vision-capable fallback order", () => {
    // given
    const multimodalLooker = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]

    // when
    const [primary, secondary, tertiary, last] = multimodalLooker.fallbackChain

    // then
    expect(multimodalLooker.fallbackChain).toHaveLength(4)
    expect(primary).toEqual({
          providers: ["openai", "chatgpt-subscription", "opencode"],
          model: "gpt-5.6-sol",
          variant: "low",
        })
    expect(secondary).toEqual({
          providers: ["opencode-go"],
          model: "kimi-k3",
        })
    expect(tertiary?.model).toBe("glm-4.6v")
    expect(last).toEqual({
          providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
          model: "gpt-5-nano",
        })
  })

  test("prometheus uses Fable 5.1 xhigh, then Opus 5.5 max, before Kimi K3 max", () => {
    // given
    const prometheus = AGENT_MODEL_REQUIREMENTS["prometheus"]

    // when
    const [primary, opusFallback, kimiFallback] = prometheus.fallbackChain

    // then
    expect(prometheus.fallbackChain).toHaveLength(3)
    expect(primary).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-fable-5-1",
          variant: "xhigh",
        })
    expect(opusFallback).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5-5",
          variant: "max",
        })
    expect(kimiFallback).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
          model: "kimi-k3",
          variant: "max",
        })
  })

  test("metis uses Fable 5.1 max, then Opus 5 max, then Kimi K3 max", () => {
    // given
    const metis = AGENT_MODEL_REQUIREMENTS["metis"]

    // when
    const [primary, opusFallback, kimiFallback] = metis.fallbackChain

    // then
    expect(metis.fallbackChain).toHaveLength(3)
    expect(primary).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-fable-5-1",
          variant: "max",
        })
    expect(opusFallback).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5-5",
          variant: "max",
        })
    expect(kimiFallback).toEqual({
          providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"],
          model: "kimi-k3",
          variant: "max",
        })
  })

  test("momus leads with native gpt-6-astra xhigh before the Copilot and opencode Astra rungs", () => {
    // given
    const momus = AGENT_MODEL_REQUIREMENTS["momus"]

    // when
    const [primary, copilot, astraHighFallback, opusFallback] = momus.fallbackChain

    // then
    expect(momus.fallbackChain.length).toBeGreaterThan(1)
    expect(primary).toEqual({
          providers: ["openai", "chatgpt-subscription"],
          model: "gpt-6-astra",
          variant: "xhigh",
        })
    expect(copilot).toEqual({
          providers: ["github-copilot"],
          model: "gpt-6-astra",
          variant: "high",
        })
    expect(astraHighFallback).toEqual({
          providers: ["openai", "chatgpt-subscription", "opencode"],
          model: "gpt-6-astra",
          variant: "high",
        })
    expect(opusFallback).toEqual({
          providers: ["anthropic", "github-copilot", "opencode"],
          model: "claude-opus-5-5",
          variant: "max",
        })
    expect(momus.fallbackChain.some((entry) => entry.model.startsWith("gpt-5.6-"))).toBe(false)
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
          providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
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

  test("hephaestus supports openai, chatgpt-subscription, github-copilot, and opencode providers", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when / then
    expect(hephaestus.requiresProvider).toEqual([
      "openai",
      "chatgpt-subscription",
      "github-copilot",
      "opencode",
    ])
    expect(hephaestus.requiresProvider).not.toContain("venice")
    expect(hephaestus.fallbackChain[0]?.providers).not.toContain("venice")
    expect(hephaestus.requiresModel).toBeUndefined()
    expect(hephaestus.requiresAnyModel).toBe(true)
  })

  test("hephaestus leads with one merged gpt-6-sol medium rung over its gpt-5.6-sol predecessor", () => {
    // given
    const hephaestus = AGENT_MODEL_REQUIREMENTS["hephaestus"]

    // when
    const [primary, fallback] = hephaestus.fallbackChain

    // then
    expect(hephaestus.fallbackChain).toHaveLength(2)
    expect(primary).toEqual({
          providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
          model: "gpt-6-sol",
          variant: "medium",
        })
    expect(fallback).toEqual({
          providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
          model: "gpt-5.6-sol",
          variant: "medium",
        })
  })

})
