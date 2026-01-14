import { describe, expect, test } from "bun:test"

import { ANTIGRAVITY_PROVIDER_CONFIG, generateOmoConfig } from "./config-manager"
import type { InstallConfig } from "./types"

describe("config-manager ANTIGRAVITY_PROVIDER_CONFIG", () => {
  test("Gemini models include full spec (limit + modalities)", () => {
    const google = (ANTIGRAVITY_PROVIDER_CONFIG as any).google
    expect(google).toBeTruthy()

    const models = google.models as Record<string, any>
    expect(models).toBeTruthy()

    const required = [
      "antigravity-gemini-3-pro-high",
      "antigravity-gemini-3-pro-low",
      "antigravity-gemini-3-flash",
    ]

    for (const key of required) {
      const model = models[key]
      expect(model).toBeTruthy()
      expect(typeof model.name).toBe("string")
      expect(model.name.includes("(Antigravity)")).toBe(true)

      expect(model.limit).toBeTruthy()
      expect(typeof model.limit.context).toBe("number")
      expect(typeof model.limit.output).toBe("number")

      expect(model.modalities).toBeTruthy()
      expect(Array.isArray(model.modalities.input)).toBe(true)
      expect(Array.isArray(model.modalities.output)).toBe(true)
    }
  })
})

describe("generateOmoConfig - GitHub Copilot fallback", () => {
  test("frontend-ui-ux-engineer uses Copilot when no native providers", () => {
    // #given user has only Copilot (no Claude, ChatGPT, Gemini)
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then frontend-ui-ux-engineer should use Copilot Gemini
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["frontend-ui-ux-engineer"]?.model).toBe("github-copilot/gemini-3-pro-preview")
  })

  test("document-writer uses Copilot when no native providers", () => {
    // #given user has only Copilot
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then document-writer should use Copilot Gemini Flash
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["document-writer"]?.model).toBe("github-copilot/gemini-3-flash-preview")
  })

  test("multimodal-looker uses Copilot when no native providers", () => {
    // #given user has only Copilot
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then multimodal-looker should use Copilot Gemini Flash
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["multimodal-looker"]?.model).toBe("github-copilot/gemini-3-flash-preview")
  })

  test("explore uses Copilot grok-code when no native providers", () => {
    // #given user has only Copilot
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then explore should use Copilot Grok
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["explore"]?.model).toBe("github-copilot/grok-code-fast-1")
  })

  test("native Gemini takes priority over Copilot for frontend-ui-ux-engineer", () => {
    // #given user has both Gemini and Copilot
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: true,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then native Gemini should be used (NOT Copilot)
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["frontend-ui-ux-engineer"]?.model).toBe("google/antigravity-gemini-3-pro-high")
  })

  test("native Claude takes priority over Copilot for frontend-ui-ux-engineer", () => {
    // #given user has Claude and Copilot but no Gemini
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then native Claude should be used (NOT Copilot)
    const agents = result.agents as Record<string, { model?: string }>
    expect(agents["frontend-ui-ux-engineer"]?.model).toBe("anthropic/claude-opus-4-5")
  })

  test("categories use Copilot models when no native Gemini", () => {
    // #given user has Copilot but no Gemini
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasChatGPT: false,
      hasGemini: false,
      hasCopilot: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then categories should use Copilot models
    const categories = result.categories as Record<string, { model?: string }>
    expect(categories?.["visual-engineering"]?.model).toBe("github-copilot/gemini-3-pro-preview")
    expect(categories?.["artistry"]?.model).toBe("github-copilot/gemini-3-pro-preview")
    expect(categories?.["writing"]?.model).toBe("github-copilot/gemini-3-flash-preview")
  })
})
