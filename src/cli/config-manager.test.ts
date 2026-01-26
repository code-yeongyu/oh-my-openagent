import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { parseJsonc } from "../shared"

import { ANTIGRAVITY_PROVIDER_CONFIG, getPluginNameWithVersion, fetchNpmDistTags, generateOmoConfig, detectProvidersFromConfig } from "./config-manager"
import type { InstallConfig } from "./types"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns @latest when current version matches latest tag", async () => {
    // #given npm dist-tags with latest=2.14.0
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should use @latest tag
    expect(result).toBe("oh-my-opencode@latest")
  })

  test("returns @beta when current version matches beta tag", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should use @beta tag
    expect(result).toBe("oh-my-opencode@beta")
  })

  test("returns @next when current version matches next tag", async () => {
    // #given npm dist-tags with next=3.1.0-next.1
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3", next: "3.1.0-next.1" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.1.0-next.1
    const result = await getPluginNameWithVersion("3.1.0-next.1")

    // #then should use @next tag
    expect(result).toBe("oh-my-opencode@next")
  })

  test("returns pinned version when no tag matches", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is old beta 3.0.0-beta.2
    const result = await getPluginNameWithVersion("3.0.0-beta.2")

    // #then should pin to specific version
    expect(result).toBe("oh-my-opencode@3.0.0-beta.2")
  })

  test("returns pinned version when fetch fails", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should fall back to pinned version
    expect(result).toBe("oh-my-opencode@3.0.0-beta.3")
  })

  test("returns pinned version when npm returns non-ok response", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should fall back to pinned version
    expect(result).toBe("oh-my-opencode@2.14.0")
  })

  test("prioritizes latest over other tags when version matches multiple", async () => {
    // #given version matches both latest and beta (during release promotion)
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ beta: "3.0.0", latest: "3.0.0", next: "3.1.0-alpha.1" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version matches both
    const result = await getPluginNameWithVersion("3.0.0")

    // #then should prioritize @latest
    expect(result).toBe("oh-my-opencode@latest")
  })
})

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    // #given npm returns dist-tags
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return the tags
    expect(result).toEqual({ latest: "2.14.0", beta: "3.0.0-beta.3" })
  })

  test("returns null on network failure", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })
})

describe("config-manager ANTIGRAVITY_PROVIDER_CONFIG", () => {
  test("all models include full spec (limit + modalities + Antigravity label)", () => {
    const google = (ANTIGRAVITY_PROVIDER_CONFIG as any).google
    expect(google).toBeTruthy()

    const models = google.models as Record<string, any>
    expect(models).toBeTruthy()

    const required = [
      "antigravity-gemini-3-pro",
      "antigravity-gemini-3-flash",
      "antigravity-claude-sonnet-4-5",
      "antigravity-claude-sonnet-4-5-thinking",
      "antigravity-claude-opus-4-5-thinking",
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

  test("Gemini models have variant definitions", () => {
    // #given the antigravity provider config
    const models = (ANTIGRAVITY_PROVIDER_CONFIG as any).google.models as Record<string, any>

    // #when checking Gemini Pro variants
    const pro = models["antigravity-gemini-3-pro"]
    // #then should have low and high variants
    expect(pro.variants).toBeTruthy()
    expect(pro.variants.low).toBeTruthy()
    expect(pro.variants.high).toBeTruthy()

    // #when checking Gemini Flash variants
    const flash = models["antigravity-gemini-3-flash"]
    // #then should have minimal, low, medium, high variants
    expect(flash.variants).toBeTruthy()
    expect(flash.variants.minimal).toBeTruthy()
    expect(flash.variants.low).toBeTruthy()
    expect(flash.variants.medium).toBeTruthy()
    expect(flash.variants.high).toBeTruthy()
  })

  test("Claude thinking models have variant definitions", () => {
    // #given the antigravity provider config
    const models = (ANTIGRAVITY_PROVIDER_CONFIG as any).google.models as Record<string, any>

    // #when checking Claude thinking variants
    const sonnetThinking = models["antigravity-claude-sonnet-4-5-thinking"]
    const opusThinking = models["antigravity-claude-opus-4-5-thinking"]

    // #then both should have low and max variants
    for (const model of [sonnetThinking, opusThinking]) {
      expect(model.variants).toBeTruthy()
      expect(model.variants.low).toBeTruthy()
      expect(model.variants.max).toBeTruthy()
    }
  })
})

describe("generateOmoConfig - model fallback system", () => {
  test("generates native sonnet models when Claude standard subscription", () => {
    // #given user has Claude standard subscription (not max20)
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then should use native anthropic sonnet (cost-efficient for standard plan)
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json")
    expect(result.agents).toBeDefined()
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("anthropic/claude-sonnet-4-5")
  })

  test("generates native opus models when Claude max20 subscription", () => {
    // #given user has Claude max20 subscription
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then should use native anthropic opus (max power for max20 plan)
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("anthropic/claude-opus-4-5")
  })

  test("uses github-copilot sonnet fallback when only copilot available", () => {
    // #given user has only copilot (no max plan)
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: true,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then should use github-copilot sonnet models (copilot fallback)
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("github-copilot/claude-sonnet-4.5")
  })

  test("uses ultimate fallback when no providers configured", () => {
    // #given user has no providers
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then should use ultimate fallback for all agents
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json")
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("opencode/big-pickle")
  })

  test("uses zai-coding-plan/glm-4.7 for librarian when Z.ai available", () => {
    // #given user has Z.ai and Claude max20
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: true,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then librarian should use zai-coding-plan/glm-4.7
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("zai-coding-plan/glm-4.7")
    // #then other agents should use native opus (max20 plan)
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("anthropic/claude-opus-4-5")
  })

  test("uses native OpenAI models when only ChatGPT available", () => {
    // #given user has only ChatGPT subscription
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: true,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then Sisyphus should use native OpenAI (fallback within native tier)
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("openai/gpt-5.2")
    // #then Oracle should use native OpenAI (first fallback entry)
    expect((result.agents as Record<string, { model: string }>).oracle.model).toBe("openai/gpt-5.2")
    // #then multimodal-looker should use native OpenAI (fallback within native tier)
    expect((result.agents as Record<string, { model: string }>)["multimodal-looker"].model).toBe("openai/gpt-5.2")
  })

  test("uses haiku for explore when Claude max20", () => {
    // #given user has Claude max20
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then explore should use haiku (max20 plan uses Claude quota)
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe("anthropic/claude-haiku-4-5")
  })

  test("uses haiku for explore regardless of max20 flag", () => {
    // #given user has Claude but not max20
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then explore should use haiku (isMax20 doesn't affect explore anymore)
    expect((result.agents as Record<string, { model: string }>).explore.model).toBe("anthropic/claude-haiku-4-5")
  })

  test("detects claude=yes (standard) from saved config with sonnet model", () => {
    // #given a config generated for Claude standard subscription
    const installConfig: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }
    const savedConfig = generateOmoConfig(installConfig)

    // #when checking the saved config
    const sisyphusModel = (savedConfig.agents as Record<string, { model: string }>).sisyphus.model

    // #then sisyphus should use sonnet (standard plan)
    expect(sisyphusModel).toBe("anthropic/claude-sonnet-4-5")
    // #then isMax20 can be inferred as false from sonnet model
    expect(sisyphusModel.includes("sonnet")).toBe(true)
    expect(sisyphusModel.includes("opus")).toBe(false)
  })

  test("detects claude=max20 from saved config with opus model", () => {
    // #given a config generated for Claude max20 subscription
    const installConfig: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }
    const savedConfig = generateOmoConfig(installConfig)

    // #when checking the saved config
    const sisyphusModel = (savedConfig.agents as Record<string, { model: string }>).sisyphus.model

    // #then sisyphus should use opus (max20 plan)
    expect(sisyphusModel).toBe("anthropic/claude-opus-4-5")
    // #then isMax20 can be inferred as true from opus model
    expect(sisyphusModel.includes("opus")).toBe(true)
    expect(sisyphusModel.includes("sonnet")).toBe(false)
  })

  test("roundtrip: claude=yes (standard) can be detected from saved config", () => {
    // #given user selects claude=yes during install
    const installConfig: InstallConfig = {
      hasClaude: true,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when config is generated and saved
    const savedConfig = generateOmoConfig(installConfig)
    const configJson = JSON.stringify(savedConfig)
    const parsedConfig = parseJsonc<typeof savedConfig>(configJson)

    // #then sisyphus should use sonnet
    const agents = parsedConfig?.agents as Record<string, { model: string }> | undefined
    expect(agents?.sisyphus?.model).toBe("anthropic/claude-sonnet-4-5")

    // #then detectProvidersFromOmoConfig should correctly infer isMax20=false and hasClaude=true
    const sisyphusModel = agents?.sisyphus?.model || ""
    const usesOpus = sisyphusModel.includes("claude-opus-4-5")
    const usesSonnet = sisyphusModel.includes("claude-sonnet-4-5")
    const usesOtherClaude = !usesOpus && !usesSonnet && sisyphusModel.includes("claude")
    const detectedIsMax20 = usesOpus
    const detectedHasClaude = usesOpus || usesSonnet || usesOtherClaude

    expect(detectedIsMax20).toBe(false)
    expect(detectedHasClaude).toBe(true)
  })

  test("roundtrip: claude=max20 can be detected from saved config", () => {
    // #given user selects claude=max20 during install
    const installConfig: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when config is generated and saved
    const savedConfig = generateOmoConfig(installConfig)
    const configJson = JSON.stringify(savedConfig)
    const parsedConfig = parseJsonc<typeof savedConfig>(configJson)

    // #then sisyphus should use opus
    const agents = parsedConfig?.agents as Record<string, { model: string }> | undefined
    expect(agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-5")

    // #then detectProvidersFromOmoConfig should correctly infer isMax20=true and hasClaude=true
    const sisyphusModel = agents?.sisyphus?.model || ""
    const usesOpus = sisyphusModel.includes("claude-opus-4-5")
    const usesSonnet = sisyphusModel.includes("claude-sonnet-4-5")
    const usesOtherClaude = !usesOpus && !usesSonnet && sisyphusModel.includes("claude")
    const detectedIsMax20 = usesOpus
    const detectedHasClaude = usesOpus || usesSonnet || usesOtherClaude

    expect(detectedIsMax20).toBe(true)
    expect(detectedHasClaude).toBe(true)
  })

  test("roundtrip: all providers detected correctly", () => {
    // #given user has all providers configured
    const installConfig: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: true,
      hasGemini: true,
      hasCopilot: true,
      hasOpencodeZen: true,
      hasZaiCodingPlan: true,
    }

    // #when config is generated
    const savedConfig = generateOmoConfig(installConfig)
    const agents = savedConfig.agents as Record<string, { model: string }> | undefined

    // #then all providers should have models in config
    let hasAnyClaude = false
    let hasAnyOpenAI = false
    let hasAnyOpencodeZen = false
    let hasAnyZai = false
    let hasAnyCopilot = false

    for (const agentConfig of Object.values(agents || {})) {
      const model = agentConfig?.model || ""
      if (model.startsWith("anthropic/") || model.includes("claude")) hasAnyClaude = true
      if (model.startsWith("openai/")) hasAnyOpenAI = true
      if (model.startsWith("opencode/")) hasAnyOpencodeZen = true
      if (model.startsWith("zai-coding-plan/")) hasAnyZai = true
      if (model.startsWith("github-copilot/")) hasAnyCopilot = true
    }

    expect(hasAnyClaude).toBe(true)
    expect(hasAnyOpenAI).toBe(true)
    expect(hasAnyZai).toBe(true)
  })

  test("roundtrip: OpenAI-only config detects correctly", () => {
    // #given user has only OpenAI
    const installConfig: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: true,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when config is generated
    const savedConfig = generateOmoConfig(installConfig)
    const agents = savedConfig.agents as Record<string, { model: string }> | undefined

    // #then should find openai/ models
    let hasAnyOpenAI = false
    for (const agentConfig of Object.values(agents || {})) {
      const model = agentConfig?.model || ""
      if (model.startsWith("openai/")) hasAnyOpenAI = true
    }

    expect(hasAnyOpenAI).toBe(true)
  })

  test("roundtrip: Copilot-only config detects correctly", () => {
    // #given user has only Copilot
    const installConfig: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: true,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
    }

    // #when config is generated
    const savedConfig = generateOmoConfig(installConfig)
    const agents = savedConfig.agents as Record<string, { model: string }> | undefined

    // #then should find github-copilot/ models
    let hasAnyCopilot = false
    for (const agentConfig of Object.values(agents || {})) {
      const model = agentConfig?.model || ""
      if (model.startsWith("github-copilot/")) hasAnyCopilot = true
    }

    expect(hasAnyCopilot).toBe(true)
  })

  test("roundtrip: OpenCode Zen-only config detects correctly", () => {
    // #given user has only OpenCode Zen
    const installConfig: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
    }

    // #when config is generated
    const savedConfig = generateOmoConfig(installConfig)
    const agents = savedConfig.agents as Record<string, { model: string }> | undefined

    // #then should find opencode/ models
    let hasAnyOpencodeZen = false
    for (const agentConfig of Object.values(agents || {})) {
      const model = agentConfig?.model || ""
      if (model.startsWith("opencode/")) hasAnyOpencodeZen = true
    }

    expect(hasAnyOpencodeZen).toBe(true)
  })

  test("detectProvidersFromConfig: categories-only config detects providers", () => {
    const categoriesOnlyConfig = {
      categories: {
        "visual-engineering": { model: "openai/gpt-5.2", temperature: 0.7 },
        "quick": { model: "github-copilot/starcoder", temperature: 0.1 },
        "ultrabrain": { model: "anthropic/claude-opus-4-5", temperature: 0.1 },
        "artistry": { model: "opencode/claude-sonnet-4-5", temperature: 0.8 },
        "writing": { model: "zai-coding-plan/glm-4.7", temperature: 0.3 },
      },
    }

    const detected = detectProvidersFromConfig(categoriesOnlyConfig)

    expect(detected.hasOpenAI).toBe(true)
    expect(detected.hasCopilot).toBe(true)
    expect(detected.hasClaude).toBe(true)
    expect(detected.isMax20).toBe(true)
    expect(detected.hasOpencodeZen).toBe(true)
    expect(detected.hasZaiCodingPlan).toBe(true)
  })

  test("detectProvidersFromConfig: mixed agents and categories detects all", () => {
    const mixedConfig = {
      agents: {
        sisyphus: { model: "openai/gpt-5.2" },
        oracle: { model: "anthropic/claude-opus-4-5" },
      },
      categories: {
        "quick": { model: "github-copilot/starcoder" },
        "visual-engineering": { model: "opencode/claude-sonnet-4-5" },
      },
    }

    const detected = detectProvidersFromConfig(mixedConfig)

    expect(detected.hasOpenAI).toBe(true)
    expect(detected.hasCopilot).toBe(true)
    expect(detected.hasClaude).toBe(true)
    expect(detected.isMax20).toBe(true)
    expect(detected.hasOpencodeZen).toBe(true)
  })
})
