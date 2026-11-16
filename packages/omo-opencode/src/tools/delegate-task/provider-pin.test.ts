import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { ProviderModelsConfig } from "../../config/schema/provider-models"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { __resetModelCache } from "../../shared/model-availability"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import { createDelegateTask } from "./tools"
import type { DelegateTaskToolOptions } from "./types"

type LaunchInput = Record<string, unknown> & {
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string }
  readonly fallbackChain?: unknown
  readonly providerPin?: string
}

const PROVIDER_MODELS: ProviderModelsConfig = {
  openai: {
    agents: { explore: { model: "openai/gpt-6-luna-fast", variant: "low" } },
    categories: { quick: { model: "openai/gpt-6-luna-fast", variant: "low" } },
  },
  anthropic: {
    agents: { explore: { model: "anthropic/claude-haiku-5-5" } },
    categories: { quick: { model: "anthropic/claude-haiku-5-5" } },
  },
}

const toolContext = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

function createHarness(options: Partial<DelegateTaskToolOptions> = {}) {
  const launches: LaunchInput[] = []
  const manager = {
    launch: async (input: LaunchInput) => {
      launches.push(input)
      return {
        id: `bg_${launches.length}`,
        sessionId: `ses_child_${launches.length}`,
        status: "running",
        agent: input.agent,
      }
    },
    getTask: () => undefined,
  }
  const client = {
    app: {
      agents: async () => ({
        data: [{ name: "explore", mode: "subagent", model: { providerID: "openai", modelID: "gpt-6-luna-fast" } }],
      }),
    },
    config: { get: async () => ({ data: { model: "anthropic/claude-sonnet-5-5" } }) },
    session: {
      get: async () => ({ data: { directory: "/tmp" } }),
      create: async () => ({ data: { id: "ses_child" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }
  const tool = createDelegateTask(
    unsafeTestValue({
      manager,
      client,
      directory: "/tmp",
      userCategories: { quick: { model: "anthropic/claude-haiku-5-5" } },
      agentOverrides: { "sisyphus-junior": { model: "openai/gpt-6.1-sol", variant: "xhigh" } },
      sisyphusJuniorModel: "openai/gpt-6.1-sol",
      ...options,
    }),
  )
  return { tool, launches }
}

async function run(tool: ReturnType<typeof createDelegateTask>, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute(
    unsafeTestValue({ description: "pin test", prompt: "say hi", load_skills: [], run_in_background: true, ...args }),
    unsafeTestValue(toolContext),
  )
  return typeof result === "string" ? result : JSON.stringify(result)
}

describe("task provider override", () => {
  let providerModelsSpy: ReturnType<typeof spyOn>
  let connectedSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    __resetModelCache()
    __setTimingConfig({ WAIT_FOR_SESSION_INTERVAL_MS: 1, WAIT_FOR_SESSION_TIMEOUT_MS: 50 })
    connectedSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([
      "openai",
      "anthropic",
    ])
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      connected: ["openai", "anthropic"],
      models: {
        openai: ["gpt-6.1-sol", "gpt-6-luna-fast"],
        anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
      },
      updatedAt: "2026-11-16T00:00:00.000Z",
    })
  })

  afterEach(() => {
    __resetTimingConfig()
    releaseAllPromptAsyncReservationsForTesting()
    connectedSpy.mockRestore()
    providerModelsSpy.mockRestore()
  })

  describe("#given provider is omitted", () => {
    test("#then the launch is identical with and without provider_models configured", async () => {
      // given
      const plain = createHarness()
      const pinned = createHarness({ providerModels: PROVIDER_MODELS })

      // when
      await run(plain.tool, { category: "quick" })
      await run(pinned.tool, { category: "quick" })
      await run(plain.tool, { subagent_type: "explore" })
      await run(pinned.tool, { subagent_type: "explore" })

      // then
      expect(JSON.stringify(pinned.launches)).toBe(JSON.stringify(plain.launches))
      expect(plain.launches[0]?.model).toMatchObject({ providerID: "anthropic", modelID: "claude-haiku-5-5" })
    })

    test("#then the tool schema has no provider argument when no pin set is configured", () => {
      // given
      const plain = createHarness()
      const pinned = createHarness({ providerModels: PROVIDER_MODELS })

      // then
      expect(Object.keys(plain.tool.args)).not.toContain("provider")
      expect(Object.keys(pinned.tool.args)).toContain("provider")
    })
  })

  describe("#given provider is passed", () => {
    test("#then a category runs on the provider's pin, beating the category model, the Junior pin and fallbacks", async () => {
      // given
      const { tool, launches } = createHarness({ providerModels: PROVIDER_MODELS })

      // when
      await run(tool, { category: "quick", provider: "openai" })

      // then
      const launch = launches[0]
      expect(launch?.agent).toBe("Sisyphus-Junior")
      expect(launch?.model).toEqual({ providerID: "openai", modelID: "gpt-6-luna-fast", variant: "low" })
      expect(launch?.fallbackChain).toBeUndefined()
      expect(launch?.providerPin).toBe("openai")
    })

    test("#then a subagent runs on the provider's agent pin", async () => {
      // given
      const { tool, launches } = createHarness({ providerModels: PROVIDER_MODELS })

      // when
      await run(tool, { subagent_type: "explore", provider: "anthropic" })

      // then
      expect(launches[0]?.model).toEqual({ providerID: "anthropic", modelID: "claude-haiku-5-5" })
      expect(launches[0]?.fallbackChain).toBeUndefined()
      expect(launches[0]?.providerPin).toBe("anthropic")
    })

    test("#then a missing agent pin fails naming the provider, the agent and the key, and launches nothing", async () => {
      // given
      const { tool, launches } = createHarness({
        providerModels: { openai: { categories: { quick: { model: "openai/gpt-6-luna-fast" } } } },
      })

      // when
      const result = await run(tool, { subagent_type: "explore", provider: "openai" })

      // then
      expect(launches).toHaveLength(0)
      expect(result).toContain('provider "openai"')
      expect(result).toContain('agent "explore"')
      expect(result).toContain("provider_models.openai.agents.explore")
    })

    test("#then a missing category pin fails with its key", async () => {
      // given
      const { tool, launches } = createHarness({ providerModels: PROVIDER_MODELS })

      // when
      const result = await run(tool, { category: "writing", provider: "anthropic" })

      // then
      expect(launches).toHaveLength(0)
      expect(result).toContain('category "writing"')
      expect(result).toContain("provider_models.anthropic.categories.writing")
    })

    test("#then a provider without a pin set fails instead of using default routing", async () => {
      // given
      const { tool, launches } = createHarness({
        providerModels: { openai: PROVIDER_MODELS.openai },
      })

      // when
      const result = await run(tool, { category: "quick", provider: "anthropic" })

      // then
      expect(launches).toHaveLength(0)
      expect(result).toContain("provider_models.anthropic")
    })

    test("#then continuation calls are refused", async () => {
      // given
      const { tool, launches } = createHarness({ providerModels: PROVIDER_MODELS })

      // when
      const resumeResult = await run(tool, { task_id: "ses_existing", provider: "openai" })

      // then
      expect(launches).toHaveLength(0)
      expect(resumeResult).toContain("provider")
    })
  })
})
