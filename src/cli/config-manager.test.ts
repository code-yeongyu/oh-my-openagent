import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

import { ANTIGRAVITY_PROVIDER_CONFIG, getPluginNameWithVersion, fetchNpmDistTags, generateOmoConfig } from "./config-manager"
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
})
