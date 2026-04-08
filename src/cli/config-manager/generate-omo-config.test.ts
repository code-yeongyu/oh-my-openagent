/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

mock.module("../../shared/connected-providers-cache", () => ({
  readConnectedProvidersCache: () => null,
  readProviderModelsCache: () => null,
}))

import { generateOmoConfig } from "../config-manager"
import type { InstallConfig } from "../types"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"

describe("generateOmoConfig - model fallback system", () => {
  test("uses github-copilot sonnet fallback when only copilot available", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: true,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe(
      `github-copilot/${transformModelForProvider("github-copilot", "claude-opus")}`,
    )
  })

  test("uses ultimate fallback when no providers configured", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json")
    expect((result.agents as Record<string, { model: string }>).sisyphus).toBeUndefined()
  })

  test("uses ZAI model for librarian when Z.ai is available", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: true,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("zai-coding-plan/glm-4.7")
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe(
      `anthropic/${transformModelForProvider("anthropic", "claude-opus")}`,
    )
  })

  test("uses native OpenAI models when only ChatGPT available", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: true,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect((result.agents as Record<string, { model: string; variant?: string }>).sisyphus.model).toBe("openai/gpt-5.4")
    expect((result.agents as Record<string, { model: string; variant?: string }>).sisyphus.variant).toBe("medium")
    expect((result.agents as Record<string, { model: string }>).oracle.model).toBe("openai/gpt-5.4")
    expect((result.agents as Record<string, { model: string }>)['multimodal-looker'].model).toBe("openai/gpt-5.4")
  })

  test("adds fallback_models when multiple providers are available", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: true,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)
    const agents = result.agents as Record<string, {
      model: string
      variant?: string
      fallback_models?: Array<{ model: string; variant?: string }>
    }>
    const categories = result.categories as Record<string, {
      model: string
      variant?: string
      fallback_models?: Array<{ model: string; variant?: string }>
    }>

    //#then
    expect(agents.sisyphus.model).toBe(`anthropic/${transformModelForProvider("anthropic", "claude-opus")}`)
    expect(agents.sisyphus.fallback_models).toEqual([
      {
        model: "openai/gpt-5.4",
        variant: "medium",
      },
    ])
    expect(categories.deep.model).toBe("openai/gpt-5.4")
    expect(categories.deep.fallback_models).toEqual([
      {
        model: `anthropic/${transformModelForProvider("anthropic", "claude-opus")}`,
        variant: "max",
      },
    ])
  })

  test("uses haiku for explore when Claude max20", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe(
      `anthropic/${transformModelForProvider("anthropic", "claude-haiku")}`,
    )
  })

  test("uses haiku for explore regardless of max20 flag", () => {
    //#given
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
      hasOpencodeGo: false,
    }

    //#when
    const result = generateOmoConfig(config)

    //#then
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe(
      `anthropic/${transformModelForProvider("anthropic", "claude-haiku")}`,
    )
  })
})
