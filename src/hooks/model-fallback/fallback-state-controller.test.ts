import type { FallbackEntry } from "../../shared/model-requirements"

declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterAll, mock } = require("bun:test")

const mockAgentModelRequirements: Record<string, { fallbackChain?: FallbackEntry[] }> = {}
const mockGetAgentConfigKey = mock((name: string) => name.toLowerCase().replace(/ - /g, "-"))

afterAll(() => {
  mock.restore()
})

async function importFreshStateControllerModule() {
  mock.module("../../shared/agent-display-names", () => ({
    getAgentConfigKey: mockGetAgentConfigKey,
  }))

  mock.module("../../shared/model-requirements", () => ({
    AGENT_MODEL_REQUIREMENTS: mockAgentModelRequirements,
  }))

  mock.module("../../shared/connected-providers-cache", () => ({
    readConnectedProvidersCache: () => null,
    readProviderModelsCache: () => null,
  }))

  mock.module("../../shared/model-error-classifier", () => ({
    selectFallbackProvider: (providers: string[]) => providers[0] ?? "opencode",
  }))

  mock.module("../../shared/provider-model-id-transform", () => ({
    transformModelForProvider: (_provider: string, model: string) => model,
  }))

  mock.module("../../shared/logger", () => ({
    log: () => {},
  }))

  const module = await import(`./fallback-state-controller?test=${Date.now()}-${Math.random()}`)
  mock.restore()
  return module
}

const { createModelFallbackStateController } = await importFreshStateControllerModule()

describe("fallback-state-controller", () => {
  let controller: ReturnType<typeof createModelFallbackStateController>

  beforeEach(() => {
    controller = createModelFallbackStateController({
      pendingModelFallbacks: new Map(),
      lastToastKey: new Map(),
      sessionFallbackChains: new Map(),
    })

    Object.keys(mockAgentModelRequirements).forEach((key) => {
      delete mockAgentModelRequirements[key]
    })
  })

  describe("#given setSessionFallbackChain", () => {
    test("#when called with a valid chain #then stores a defensive copy", () => {
      // given
      const chain: FallbackEntry[] = [{ providers: ["anthropic"], model: "claude-opus-4-7" }]

      // when
      controller.setSessionFallbackChain("ses_1", chain)
      chain.push({ providers: ["openai"], model: "gpt-5.5" })

      // then
      const stored = controller.getSessionFallbackChain("ses_1")
      expect(stored).toEqual([{ providers: ["anthropic"], model: "claude-opus-4-7" }])
    })

    test("#when called with undefined #then stores empty array", () => {
      // given
      controller.setSessionFallbackChain("ses_2", [{ providers: ["a"], model: "m" }])

      // when
      controller.setSessionFallbackChain("ses_2", undefined)

      // then the chain is stored as empty (not deleted)
      const stored = controller.getSessionFallbackChain("ses_2")
      expect(stored).toEqual([])
    })

    test("#when called with empty sessionID #then does nothing", () => {
      // when
      controller.setSessionFallbackChain("", [{ providers: ["a"], model: "m" }])

      // then
      expect(controller.getSessionFallbackChain("")).toBeUndefined()
    })
  })

  describe("#given getSessionFallbackChain", () => {
    test("#when chain exists #then returns a defensive copy", () => {
      // given
      controller.setSessionFallbackChain("ses_3", [{ providers: ["anthropic"], model: "opus" }])

      // when
      const first = controller.getSessionFallbackChain("ses_3")
      first?.push({ providers: ["openai"], model: "gpt" })

      // then subsequent get is unaffected
      expect(controller.getSessionFallbackChain("ses_3")).toEqual([
        { providers: ["anthropic"], model: "opus" },
      ])
    })

    test("#when chain does not exist #then returns undefined", () => {
      expect(controller.getSessionFallbackChain("nonexistent")).toBeUndefined()
    })
  })

  describe("#given clearSessionFallbackChain", () => {
    test("#when called #then removes the chain entirely", () => {
      // given
      controller.setSessionFallbackChain("ses_4", [{ providers: ["a"], model: "m" }])

      // when
      controller.clearSessionFallbackChain("ses_4")

      // then
      expect(controller.getSessionFallbackChain("ses_4")).toBeUndefined()
    })
  })

  describe("#given setPendingModelFallback", () => {
    test("#when no chain exists for agent #then returns false", () => {
      // given no session chain and no agent requirements
      // when
      const result = controller.setPendingModelFallback("ses_5", "unknown-agent", "anthropic", "claude-opus-4-7")

      // then
      expect(result).toBe(false)
    })

    test("#when session chain is empty #then returns false", () => {
      // given session chain explicitly set to empty
      controller.setSessionFallbackChain("ses_6", undefined)

      // when
      const result = controller.setPendingModelFallback("ses_6", "sisyphus", "anthropic", "claude-opus-4-7")

      // then
      expect(result).toBe(false)
    })

    test("#when valid chain exists #then arms the fallback and returns true", () => {
      // given
      controller.setSessionFallbackChain("ses_7", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])

      // when
      const result = controller.setPendingModelFallback("ses_7", "sisyphus", "anthropic", "claude-opus-4-7")

      // then
      expect(result).toBe(true)
      expect(controller.hasPendingModelFallback("ses_7")).toBe(true)
    })

    test("#when fallback already pending #then returns false", () => {
      // given
      controller.setSessionFallbackChain("ses_8", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])
      controller.setPendingModelFallback("ses_8", "sisyphus", "anthropic", "claude-opus-4-7")

      // when
      const result = controller.setPendingModelFallback("ses_8", "sisyphus", "anthropic", "claude-opus-4-7")

      // then
      expect(result).toBe(false)
    })

    test("#when chain exhausted #then returns false on re-arm", () => {
      // given a single-entry chain
      controller.setSessionFallbackChain("ses_9", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])
      controller.setPendingModelFallback("ses_9", "sisyphus", "anthropic", "claude-opus-4-7")

      // consume the fallback
      controller.getNextFallback("ses_9")

      // when trying to re-arm with a different model after chain is exhausted
      const result = controller.setPendingModelFallback("ses_9", "sisyphus", "openai", "gpt-5.5")

      // then
      expect(result).toBe(false)
    })

    test("#when uses agent requirements as fallback chain source", () => {
      // given agent has requirements but no session chain
      mockAgentModelRequirements["sisyphus"] = {
        fallbackChain: [{ providers: ["openai"], model: "gpt-5.5" }],
      }
      mockGetAgentConfigKey.mockReturnValueOnce("sisyphus")

      // when
      const result = controller.setPendingModelFallback("ses_10", "Sisyphus", "anthropic", "claude-opus-4-7")

      // then
      expect(result).toBe(true)
    })
  })

  describe("#given getNextFallback", () => {
    test("#when no pending fallback #then returns null", () => {
      expect(controller.getNextFallback("ses_11")).toBeNull()
    })

    test("#when pending fallback exists #then returns next entry", () => {
      // given
      controller.setSessionFallbackChain("ses_12", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])
      controller.setPendingModelFallback("ses_12", "sisyphus", "anthropic", "claude-opus-4-7")

      // when
      const result = controller.getNextFallback("ses_12")

      // then
      expect(result).toEqual({
        providerID: "openai",
        modelID: "gpt-5.5",
        variant: undefined,
        reasoningEffort: undefined,
        temperature: undefined,
        top_p: undefined,
        maxTokens: undefined,
        thinking: undefined,
      })
    })

    test("#when all entries exhausted #then returns null and cleans up state", () => {
      // given single-entry chain, already consumed
      controller.setSessionFallbackChain("ses_13", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])
      controller.setPendingModelFallback("ses_13", "sisyphus", "anthropic", "claude-opus-4-7")
      controller.getNextFallback("ses_13")

      // re-arm
      controller.setPendingModelFallback("ses_13", "sisyphus", "openai", "gpt-5.5")

      // when
      const result = controller.getNextFallback("ses_13")

      // then
      expect(result).toBeNull()
    })
  })

  describe("#given clearPendingModelFallback", () => {
    test("#when called #then removes pending state and toast key", () => {
      // given
      controller.setSessionFallbackChain("ses_14", [
        { providers: ["openai"], model: "gpt-5.5" },
      ])
      controller.setPendingModelFallback("ses_14", "sisyphus", "anthropic", "claude-opus-4-7")
      controller.lastToastKey.set("ses_14", "some-key")

      // when
      controller.clearPendingModelFallback("ses_14")

      // then
      expect(controller.hasPendingModelFallback("ses_14")).toBe(false)
      expect(controller.lastToastKey.has("ses_14")).toBe(false)
    })
  })

  describe("#given reset", () => {
    test("#when called #then clears all state", () => {
      // given
      controller.setSessionFallbackChain("ses_15", [{ providers: ["a"], model: "m" }])
      controller.setPendingModelFallback("ses_15", "sisyphus", "a", "m-old")
      controller.lastToastKey.set("ses_15", "key")

      // when
      controller.reset()

      // then
      expect(controller.getSessionFallbackChain("ses_15")).toBeUndefined()
      expect(controller.hasPendingModelFallback("ses_15")).toBe(false)
      expect(controller.lastToastKey.size).toBe(0)
    })
  })
})

export {}
