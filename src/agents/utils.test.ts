/// <reference types="bun-types" />

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { clearSkillCache } from "../features/opencode-skill-loader/skill-content"
import * as connectedProvidersCache from "../shared/connected-providers-cache"
import * as modelAvailability from "../shared/model-availability"
import * as shared from "../shared"
import { transformModelForProvider } from "../shared/provider-model-id-transform"

const TEST_DEFAULT_MODEL = "anthropic/claude-opus-4-6"
let createBuiltinAgents: (typeof import("./builtin-agents"))["createBuiltinAgents"]
const EXPECTED_FIRST_RUN_SISYPHUS_MODEL = `anthropic/${transformModelForProvider("anthropic", "claude-opus")}`

async function importFreshBuiltinAgentsModule(): Promise<typeof import("./builtin-agents")> {
  return import(`./builtin-agents?test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  mock.restore()
  clearSkillCache()
  connectedProvidersCache._resetMemCacheForTesting()
  ;({ createBuiltinAgents } = await importFreshBuiltinAgentsModule())
})

afterEach(() => {
  clearSkillCache()
  connectedProvidersCache._resetMemCacheForTesting()
  mock.restore()
})

describe("createBuiltinAgents with model overrides", () => {
  test("Sisyphus with default model has thinking config when all models available", async () => {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set([
        "anthropic/claude-opus-4-6",
        "kimi-for-coding/k2p5",
        "opencode/kimi-k2.5-free",
        "zai-coding-plan/glm-5",
        "opencode/big-pickle",
      ])
    )

    try {
      const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], {})

      expect(agents.sisyphus.model).toBe(`anthropic/${transformModelForProvider("anthropic", "claude-opus-4-6")}`)
      expect(agents.sisyphus.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
      expect(agents.sisyphus.reasoningEffort).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("Sisyphus with GPT model override has reasoningEffort, no thinking", async () => {
    const providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())
    const overrides = {
      sisyphus: { model: "github-copilot/gpt-5.4" },
    }

    const agents = await createBuiltinAgents([], overrides, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

    expect(agents.sisyphus.model).toBe("github-copilot/gpt-5.4")
    expect(agents.sisyphus.reasoningEffort).toBe("medium")
    expect(agents.sisyphus.thinking).toBeUndefined()
    providerModelsSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  test("Atlas uses uiSelectedModel", async () => {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"])
    )
    const uiSelectedModel = "openai/gpt-5.4"

    try {
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      expect(agents.atlas).toBeDefined()
      expect(agents.atlas.model).toBe("openai/gpt-5.4")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("user config model takes priority over uiSelectedModel for sisyphus", async () => {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"])
    )
    const uiSelectedModel = "openai/gpt-5.4"
    const overrides = {
      sisyphus: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      const agents = await createBuiltinAgents(
        [],
        overrides,
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      expect(agents.sisyphus).toBeDefined()
      expect(agents.sisyphus.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("user config model takes priority over uiSelectedModel for atlas", async () => {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"])
    )
    const uiSelectedModel = "openai/gpt-5.4"
    const overrides = {
      atlas: { model: "google/antigravity-claude-opus-4-5-thinking" },
    }

    try {
      const agents = await createBuiltinAgents(
        [],
        overrides,
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        uiSelectedModel
      )

      expect(agents.atlas).toBeDefined()
      expect(agents.atlas.model).toBe("google/antigravity-claude-opus-4-5-thinking")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("Sisyphus is created on first run when no availableModels or cache exist", async () => {
    const systemDefaultModel = "anthropic/claude-opus-4-6"
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())

    try {
      const agents = await createBuiltinAgents([], {}, undefined, systemDefaultModel, undefined, undefined, [], {})

      expect(agents.sisyphus).toBeDefined()
      expect(agents.sisyphus.model).toBe(EXPECTED_FIRST_RUN_SISYPHUS_MODEL)
    } finally {
      cacheSpy.mockRestore()
      fetchSpy.mockRestore()
    }
  })

  test("Oracle uses connected provider fallback when availableModels is empty and cache exists", async () => {
    const providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set())
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai"])

    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL, undefined, undefined, [], undefined, undefined)

    expect(agents.oracle.model).toBe("openai/gpt-5.4")
    expect(agents.oracle.reasoningEffort).toBe("medium")
    expect(agents.oracle.thinking).toBeUndefined()
    cacheSpy.mockRestore?.()
    providerModelsSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  test("Oracle created without model field when no cache exists (first run scenario)", async () => {
    const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)

    const agents = await createBuiltinAgents([], {}, undefined, TEST_DEFAULT_MODEL)

    expect(agents.oracle).toBeDefined()
    expect(agents.oracle.model).toBe(TEST_DEFAULT_MODEL)
    cacheSpy.mockRestore?.()
  })
})
