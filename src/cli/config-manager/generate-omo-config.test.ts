/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { generateOmoConfig } from "../config-manager"
import type { InstallConfig } from "../types"

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
    expect([
      "github-copilot/claude-opus-4.6",
      "github-copilot/claude-opus-4-6",
    ]).toContain((result.agents as Record<string, { model: string }>).sisyphus.model)
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
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("anthropic/claude-opus-4-6")
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
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe("anthropic/claude-haiku-4-5")
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
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe("anthropic/claude-haiku-4-5")
  })
})
