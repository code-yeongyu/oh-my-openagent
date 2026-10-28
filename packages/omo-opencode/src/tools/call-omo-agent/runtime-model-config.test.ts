/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import { createModelFallbackControllerAccessor } from "../../hooks/model-fallback"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { getSessionPromptParams, setSessionPromptParams } from "../../shared/session-prompt-params-state"
import { clearAllCallOmoAgentSessionFallbackChains, clearCallOmoAgentSessionFallbackChain, getCallOmoAgentSessionFallbackChain, getCallOmoAgentSessionConfig } from "../../shared/call-omo-agent-session-config"
import { handleSessionDeletedEvent } from "../../plugin/event-session-lifecycle"
import { clearCallableAgentsCache } from "./agent-resolver"
import { createCallOmoAgent } from "./tools"

type ModelConfig = Pick<OhMyOpenCodeConfig, "agents" | "categories">
type LaunchInput = { model?: DelegatedModelConfig; fallbackChain?: FallbackEntry[]; onSessionCreated?: (sessionID: string) => void | Promise<void> }

const startupConfig: ModelConfig = {
  agents: { explore: { model: "startup/original", fallback_models: ["startup/original-backup"] } },
}
const expensiveConfig: ModelConfig = {
  agents: { explore: { model: "premium/expensive", variant: "high", fallback_models: ["premium/backup"] } },
}
const cheapConfig: ModelConfig = {
  agents: { explore: { model: "budget/cheap", variant: "low", fallback_models: ["budget/backup"] } },
}

function createFixture() {
  const launch = mock(async (_input: LaunchInput) => {
    await _input.onSessionCreated?.("background-session")
    return {
    id: "task-live-config", sessionId: "background-session", description: "Test task", agent: "explore", status: "pending",
    }
  })
  const reserveSubagentSpawn = mock(() => Promise.resolve({ commit: () => 1, rollback: () => {} }))
  const manager = { launch, getTask: mock(() => undefined), reserveSubagentSpawn } as unknown as BackgroundManager
  let sessionCount = 0
  const sessionModels = new Map<string, DelegatedModelConfig>()
  const create = mock((_input: { body: { model?: { providerID: string; id: string; variant?: string } } }) =>
    Promise.resolve({ data: { id: `new-session-${++sessionCount}` } }))
  const prompt = mock((_input: { path: { id: string }; body: { model?: DelegatedModelConfig; variant?: string } }) =>
    {
      sessionModels.set(_input.path.id, _input.body.model
        ? { ..._input.body.model, variant: _input.body.variant }
        : { providerID: "startup", modelID: "original" })
      return Promise.resolve({ data: {} })
    })
  const ctx = {
    directory: "/test",
    client: {
      app: { agents: mock(() => Promise.resolve({ data: [{ name: "explore", mode: "subagent" }] })) },
      session: {
        create,
        get: mock(() => Promise.resolve({ data: { directory: "/test" } })),
        prompt,
        status: mock(() => Promise.resolve({ data: {
          "new-session-1": { type: "idle" },
          "new-session-2": { type: "idle" },
          "existing-session": { type: "idle" },
          "background-session": { type: "idle" },
        } })),
        messages: mock((input: { path: { id: string } }) => Promise.resolve({ data: [{
          info: { role: "assistant", finish: "stop", time: { created: 1, completed: 2 }, ...sessionModels.get(input.path.id) }, parts: [{ type: "text", text: "Finished" }],
        }] })),
        abort: mock(() => Promise.resolve({ data: true })),
      },
    },
  } as unknown as PluginInput
  const toolContext = { sessionID: "parent", messageID: "msg", agent: "test", abort: new AbortController().signal } as never
  const args = { description: "Inspect config", prompt: "Find config", subagent_type: "explore", run_in_background: true }
  return { ctx, manager, launch, create, prompt, reserveSubagentSpawn, toolContext, args, sessionModels }
}

describe("call_omo_agent runtime model config", () => {
  beforeEach(() => {
    clearCallableAgentsCache()
    clearAllCallOmoAgentSessionFallbackChains()
  })
  afterEach(() => clearAllCallOmoAgentSessionFallbackChains())

  test("reloads agent model, variant and fallback for sequential new background calls", async () => {
    const fixture = createFixture()
    let currentConfig = expensiveConfig
    const loadCurrentModelConfig = mock(() => currentConfig)
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, undefined, loadCurrentModelConfig)

    expect(loadCurrentModelConfig).not.toHaveBeenCalled()
    await tool.execute(fixture.args, fixture.toolContext)
    currentConfig = cheapConfig
    await tool.execute(fixture.args, fixture.toolContext)

    expect(loadCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(fixture.launch.mock.calls.map(([input]) => input.model)).toEqual([
      { providerID: "premium", modelID: "expensive", variant: "high" },
      { providerID: "budget", modelID: "cheap", variant: "low" },
    ])
    expect(fixture.launch.mock.calls.map(([input]) => input.fallbackChain)).toEqual([
      [{ providers: ["premium"], model: "backup", variant: undefined }],
      [{ providers: ["budget"], model: "backup", variant: undefined }],
    ])
  })

  test("resolves category model and fallback from the same fresh snapshot", async () => {
    const fixture = createFixture()
    let currentConfig: ModelConfig = {
      agents: { explore: { category: "research" } },
      categories: { research: { model: "premium/expensive", variant: "high", fallback_models: ["premium/backup"] } },
    }
    const loadCurrentModelConfig = mock(() => currentConfig)
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, undefined, loadCurrentModelConfig)

    await tool.execute(fixture.args, fixture.toolContext)
    currentConfig = {
      agents: { explore: { category: "quick" } },
      categories: { quick: { model: "budget/cheap", variant: "low", fallback_models: ["budget/backup"] } },
    }
    await tool.execute(fixture.args, fixture.toolContext)

    expect(loadCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(fixture.launch.mock.calls.map(([input]) => input.model)).toEqual([
      { providerID: "premium", modelID: "expensive", variant: "high" },
      { providerID: "budget", modelID: "cheap", variant: "low" },
    ])
    expect(fixture.launch.mock.calls[1]?.[0].fallbackChain).toEqual([
      { providers: ["budget"], model: "backup", variant: undefined },
    ])
  })

  test("removing live overrides restores built-in defaults instead of startup overrides", async () => {
    const fixture = createFixture()
    let currentConfig = expensiveConfig
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, undefined, () => currentConfig)

    await tool.execute(fixture.args, fixture.toolContext)
    currentConfig = {}
    await tool.execute(fixture.args, fixture.toolContext)

    expect(fixture.launch.mock.calls[1]?.[0].fallbackChain).toEqual(AGENT_MODEL_REQUIREMENTS.explore.fallbackChain)
    expect(fixture.launch.mock.calls[1]?.[0].model?.providerID).not.toBe("startup")
    expect(fixture.launch.mock.calls[1]?.[0].model?.providerID).not.toBe("premium")
  })

  test("new sync calls reload config while continuation retains the cheap child's model and fallback without loading", async () => {
    const fixture = createFixture()
    let currentConfig = expensiveConfig
    const loadCurrentModelConfig = mock(() => currentConfig)
    const controller = createModelFallbackControllerAccessor()
    const setSessionFallbackChain = mock((_sessionID: string, _fallbackChain: FallbackEntry[] | undefined) => {})
    controller.setSessionFallbackChain = setSessionFallbackChain
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, controller, loadCurrentModelConfig)
    const syncArgs = { ...fixture.args, run_in_background: false }

    expect(await tool.execute(syncArgs, fixture.toolContext)).toContain("Finished")
    currentConfig = cheapConfig
    expect(await tool.execute(syncArgs, fixture.toolContext)).toContain("Finished")
    setSessionPromptParams("new-session-2", { temperature: 0.2, options: { reasoningEffort: "low" } })
    currentConfig = expensiveConfig
    const continuation = await tool.execute({ ...syncArgs, prompt: "Continue finding config", session_id: "new-session-2" }, fixture.toolContext)
    expect(continuation).toContain("session_id: new-session-2")
    expect(continuation).not.toContain("Error:")

    expect(loadCurrentModelConfig).toHaveBeenCalledTimes(2)
    expect(fixture.reserveSubagentSpawn).toHaveBeenCalledTimes(2)
    expect(fixture.create.mock.calls.map(([input]) => input.body.model)).toEqual([
      { providerID: "premium", id: "expensive", variant: "high" },
      { providerID: "budget", id: "cheap", variant: "low" },
    ])
    expect(fixture.prompt.mock.calls.map(([input]) => input.body.model)).toEqual([
      { providerID: "premium", modelID: "expensive" },
      { providerID: "budget", modelID: "cheap" },
      { providerID: "budget", modelID: "cheap" },
    ])
    expect(fixture.sessionModels.get("new-session-2")).toEqual({ providerID: "budget", modelID: "cheap", variant: "low" })
    expect(fixture.prompt.mock.calls.map(([input]) => input.body.variant)).toEqual(["high", "low", "low"])
    expect(setSessionFallbackChain.mock.calls).toEqual([
      ["new-session-1", [{ providers: ["premium"], model: "backup", variant: undefined }]],
      ["new-session-2", [{ providers: ["budget"], model: "backup", variant: undefined }]],
      ["new-session-2", [{ providers: ["budget"], model: "backup", variant: undefined }]],
    ])
    expect(getSessionPromptParams("new-session-2")).toEqual({ temperature: 0.2, options: { reasoningEffort: "low" } })
  }, 15_000)

  test("startup disabled_agents blocks invocation before loading model config", async () => {
    const fixture = createFixture()
    const loadCurrentModelConfig = mock(() => cheapConfig)
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, ["Explore"], startupConfig.agents, undefined, undefined, loadCurrentModelConfig)

    expect(await tool.execute(fixture.args, fixture.toolContext)).toContain("disabled via disabled_agents")
    expect(loadCurrentModelConfig).not.toHaveBeenCalled()
    expect(fixture.launch).not.toHaveBeenCalled()
  })

  test("background child's continuation retains its fallback after config changes and deletion clears it", async () => {
    const fixture = createFixture()
    let currentConfig = cheapConfig
    const loadCurrentModelConfig = mock(() => currentConfig)
    const controller = createModelFallbackControllerAccessor()
    const setSessionFallbackChain = mock((_sessionID: string, _fallbackChain: FallbackEntry[] | undefined) => {})
    controller.setSessionFallbackChain = setSessionFallbackChain
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, controller, loadCurrentModelConfig)

    await tool.execute(fixture.args, fixture.toolContext)
    currentConfig = expensiveConfig
    expect(await tool.execute({ ...fixture.args, run_in_background: false, session_id: "background-session" }, fixture.toolContext)).toContain("Finished")

    expect(loadCurrentModelConfig).toHaveBeenCalledTimes(1)
    expect(fixture.prompt.mock.calls[0]?.[0].body.model).toEqual({ providerID: "budget", modelID: "cheap" })
    expect(fixture.prompt.mock.calls[0]?.[0].body.variant).toBe("low")
    expect(setSessionFallbackChain.mock.calls).toEqual([
      ["background-session", [{ providers: ["budget"], model: "backup", variant: undefined }]],
    ])
    expect(getCallOmoAgentSessionFallbackChain("background-session")).toEqual([
      { providers: ["budget"], model: "backup", variant: undefined },
    ])
    await handleSessionDeletedEvent({
      props: { info: { id: "background-session" } },
      tmuxIntegrationEnabled: false,
      pluginConfig: {},
      pluginContext: fixture.ctx,
      managers: { skillMcpManager: { disconnectSession: mock(async () => {}) } },
      firstMessageVariantGate: { clear: mock(() => {}) },
      clearModelFallbackSession: mock(() => {}),
    } as never)
    expect(getCallOmoAgentSessionFallbackChain("background-session")).toBeUndefined()
  })

  test("untracked continuation never loads config, overrides model or clears stored prompt params", async () => {
    const fixture = createFixture()
    const loadCurrentModelConfig = mock(() => { throw new Error("Continuation must not load config") })
    const controller = createModelFallbackControllerAccessor()
    const setSessionFallbackChain = mock((_sessionID: string, _fallbackChain: FallbackEntry[] | undefined) => {})
    controller.setSessionFallbackChain = setSessionFallbackChain
    const tool = createCallOmoAgent(fixture.ctx, fixture.manager, [], startupConfig.agents, undefined, controller, loadCurrentModelConfig)
    setSessionPromptParams("existing-session", { temperature: 0.4 })

    expect(await tool.execute({ ...fixture.args, run_in_background: false, session_id: "existing-session" }, fixture.toolContext)).toContain("Finished")

    expect(loadCurrentModelConfig).not.toHaveBeenCalled()
    expect(fixture.create).not.toHaveBeenCalled()
    expect(fixture.prompt.mock.calls[0]?.[0].body).not.toHaveProperty("model")
    expect(fixture.prompt.mock.calls[0]?.[0].body).not.toHaveProperty("variant")
    expect(setSessionFallbackChain).not.toHaveBeenCalled()
    expect(getSessionPromptParams("existing-session")).toEqual({ temperature: 0.4 })
  })

  test("queued background child retains snapshot when it spawns after the parent stops waiting", async () => {
    const fixture = createFixture()
    let onSessionCreated: LaunchInput["onSessionCreated"]
    const launch = mock(async (input: LaunchInput) => {
      onSessionCreated = input.onSessionCreated
      return { id: "queued-task", sessionId: undefined, description: "Queued", agent: "explore", status: "pending" }
    })
    const manager = { launch, getTask: mock(() => undefined) } as unknown as BackgroundManager
    const loadCurrentModelConfig = mock(() => cheapConfig)
    const tool = createCallOmoAgent(fixture.ctx, manager, [], startupConfig.agents, undefined, undefined, loadCurrentModelConfig)
    const abortController = new AbortController()
    abortController.abort()

    const output = await tool.execute(fixture.args, {
      sessionID: "parent", messageID: "msg", agent: "test", abort: abortController.signal,
    } as never)

    expect(output).toContain("Session ID: pending")
    expect(getCallOmoAgentSessionConfig("late-child")).toBeUndefined()
    expect(onSessionCreated).toBeFunction()
    await onSessionCreated?.("late-child")
    expect(getCallOmoAgentSessionConfig("late-child")).toEqual({
      model: { providerID: "budget", modelID: "cheap", variant: "low" },
      fallbackChain: [{ providers: ["budget"], model: "backup", variant: undefined }],
    })
    expect(loadCurrentModelConfig).toHaveBeenCalledTimes(1)
  })

  test("background polling does not restore snapshot after a fast child was deleted", async () => {
    const fixture = createFixture()
    const launch = mock(async (input: LaunchInput) => {
      await input.onSessionCreated?.("deleted-child")
      expect(getCallOmoAgentSessionConfig("deleted-child")).toBeDefined()
      clearCallOmoAgentSessionFallbackChain("deleted-child")
      return { id: "finished-task", sessionId: "deleted-child", description: "Finished", agent: "explore", status: "completed" }
    })
    const manager = { launch, getTask: mock(() => undefined) } as unknown as BackgroundManager
    const tool = createCallOmoAgent(fixture.ctx, manager, [], startupConfig.agents, undefined, undefined, () => cheapConfig)

    await tool.execute(fixture.args, fixture.toolContext)

    expect(getCallOmoAgentSessionConfig("deleted-child")).toBeUndefined()
  })
})
