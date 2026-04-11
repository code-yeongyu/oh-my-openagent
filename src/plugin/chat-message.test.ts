import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { createChatMessageHandler } from "./chat-message"
import { createAutoSlashCommandHook } from "../hooks/auto-slash-command"
import { createKeywordDetectorHook } from "../hooks/keyword-detector"
import { createStartWorkHook } from "../hooks/start-work"
import { readBoulderState } from "../features/boulder-state"
import { _resetForTesting, setMainSession, subagentSessions, registerAgentName, updateSessionAgent, getSessionAgent } from "../features/claude-code-session-state"
import { getAgentListDisplayName } from "../shared/agent-display-names"
import { getOmoOpenCodeCacheDir, getOpenCodeCacheDir } from "../shared/data-path"
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }

function createStartWorkTemplateOutput(): ChatMessageHandlerOutput {
  return {
    message: {},
    parts: [
      {
        type: "text",
        text: `<session-context>context</session-context>\nYou are starting a Sisyphus work session.`,
      },
    ],
  }
}

function createStopContinuationGuardMock(isStopped: boolean) {
  const clearCalls: string[] = []
  const isStoppedCalls: string[] = []

  return {
    guard: {
      "chat.message": async () => {},
      stop: () => {},
      isStopped: (sessionID: string) => {
        isStoppedCalls.push(sessionID)
        return isStopped
      },
      clear: (sessionID: string) => {
        clearCalls.push(sessionID)
      },
    },
    clearCalls,
    isStoppedCalls,
  }
}

function createMockHandlerArgs(overrides?: {
  pluginConfig?: Record<string, unknown>
  shouldOverride?: boolean
}) {
  const appliedSessions: string[] = []
  return {
    ctx: { client: { tui: { showToast: async () => {} } } } as any,
    pluginConfig: (overrides?.pluginConfig ?? {}) as any,
    firstMessageVariantGate: {
      shouldOverride: () => overrides?.shouldOverride ?? false,
      markApplied: (sessionID: string) => { appliedSessions.push(sessionID) },
    },
    hooks: {
      stopContinuationGuard: null,
      backgroundNotificationHook: null,
      keywordDetector: null,
      claudeCodeHooks: null,
      autoSlashCommand: null,
      startWork: null,
      ralphLoop: null,
    } as any,
    _appliedSessions: appliedSessions,
  }
}

afterEach(() => {
  _resetForTesting()
  clearSessionModel("test-session")
  clearSessionModel("main-session")
  clearSessionModel("subagent-session")
})

describe("createChatMessageHandler - cache warning behavior", () => {
  let cacheRoot = ""
  let originalXdgCacheHome: string | undefined

  beforeEach(() => {
    cacheRoot = join(tmpdir(), `chat-message-cache-${randomUUID()}`)
    originalXdgCacheHome = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = cacheRoot
  })

  afterEach(() => {
    if (originalXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = originalXdgCacheHome
    }

    if (existsSync(cacheRoot)) {
      rmSync(cacheRoot, { recursive: true, force: true })
    }
  })

  test("does not show provider cache warning when provider-models cache exists", async () => {
    // given
    const toastCalls: Array<{ body: { title: string; message: string } }> = []
    const providerModelsCachePath = join(getOmoOpenCodeCacheDir(), "provider-models.json")
    mkdirSync(getOmoOpenCodeCacheDir(), { recursive: true })
    writeFileSync(providerModelsCachePath, JSON.stringify({
      models: {
        openai: [{ id: "gpt-5.4" }],
      },
      connected: ["openai"],
      updatedAt: new Date().toISOString(),
    }))

    const args = createMockHandlerArgs()
    args.ctx = {
      client: {
        tui: {
          showToast: async (input: { body: { title: string; message: string } }) => {
            toastCalls.push(input)
          },
        },
      },
    } as never
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), createMockOutput())

    // then
    expect(toastCalls).toHaveLength(0)
  })

  test("does not show provider cache warning when OpenCode models cache exists", async () => {
    // given
    const toastCalls: Array<{ body: { title: string; message: string } }> = []
    const modelsCachePath = join(getOpenCodeCacheDir(), "models.json")
    mkdirSync(getOpenCodeCacheDir(), { recursive: true })
    writeFileSync(modelsCachePath, JSON.stringify({
      openai: {
        id: "openai",
        models: {
          "gpt-5.4": { id: "gpt-5.4" },
        },
      },
    }))

    const args = createMockHandlerArgs()
    args.ctx = {
      client: {
        tui: {
          showToast: async (input: { body: { title: string; message: string } }) => {
            toastCalls.push(input)
          },
        },
      },
    } as never
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), createMockOutput())

    // then
    expect(toastCalls).toHaveLength(0)
  })
})

describe("createChatMessageHandler - /start-work integration", () => {
  let testDir = ""
  let originalWorkingDirectory = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `chat-message-start-work-${randomUUID()}`)
    originalWorkingDirectory = process.cwd()
    mkdirSync(join(testDir, ".sisyphus", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".sisyphus", "plans", "worker-plan.md"), "# Plan\n- [ ] Task 1")
    process.chdir(testDir)
    _resetForTesting()
    registerAgentName("prometheus")
    registerAgentName("sisyphus")
  })

  afterEach(() => {
    process.chdir(originalWorkingDirectory)
    rmSync(testDir, { recursive: true, force: true })
  })

  test("falls back to Sisyphus through the full chat.message slash-command path when Atlas is unavailable", async () => {
    // given
    updateSessionAgent("test-session", "prometheus")
    const args = createMockHandlerArgs()
    args.hooks.autoSlashCommand = createAutoSlashCommandHook({ skills: [] })
    args.hooks.startWork = createStartWorkHook({
      directory: testDir,
      client: { tui: { showToast: async () => {} } },
    } as never)
    const handler = createChatMessageHandler(args)
    const input = createMockInput("prometheus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/start-work" }],
    }

    // when
    await handler(input, output)

    // then
    expect(output.message["agent"]).toBe("sisyphus")
    expect(output.parts[0].text).toContain("<auto-slash-command>")
    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("boulder.json has been created")
    expect(getSessionAgent("test-session")).toBe("sisyphus")
    expect(readBoulderState(testDir)?.agent).toBe("sisyphus")
  })

  test("smoke: resolves quoted human-readable plan names through the full /start-work chat.message path", async () => {
    // given
    writeFileSync(join(testDir, ".sisyphus", "plans", "my-feature-plan.md"), "# Plan\n- [ ] Task 1")
    updateSessionAgent("test-session", "prometheus")
    const args = createMockHandlerArgs()
    args.hooks.autoSlashCommand = createAutoSlashCommandHook({ skills: [] })
    args.hooks.startWork = createStartWorkHook({
      directory: testDir,
      client: { tui: { showToast: async () => {} } },
    } as never)
    const handler = createChatMessageHandler(args)
    const input = createMockInput("prometheus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/start-work \"my feature plan\"" }],
    }

    // when
    await handler(input, output)

    // then
    expect(output.message["agent"]).toBe("sisyphus")
    expect(output.parts[0].text).toContain("<auto-slash-command>")
    expect(output.parts[0].text).toContain("Auto-Selected Plan")
    expect(output.parts[0].text).toContain("my-feature-plan")
    expect(readBoulderState(testDir)?.plan_name).toBe("my-feature-plan")
  })
})

describe("createChatMessageHandler - stop continuation clearing for raw slash fallback", () => {
  test("clears stop state before raw /start-work resumes work through chat.message", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const startWorkCalls: string[] = []
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.startWork = {
      "chat.message": async (input: { sessionID: string }) => {
        startWorkCalls.push(input.sessionID)
      },
    }
    const handler = createChatMessageHandler(args)
    const output = createStartWorkTemplateOutput()

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(startWorkCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.clearCalls).toEqual(["test-session"])
  })

  test("clears stop state before raw /ulw-loop resumes work through chat.message", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const startLoopCalls: Array<{ sessionID: string; prompt: string; ultrawork: boolean }> = []
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: { ultrawork?: boolean }) => {
        startLoopCalls.push({ sessionID, prompt, ultrawork: options?.ultrawork === true })
        return true
      },
      cancelLoop: () => true,
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/ulw-loop ship it" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(startLoopCalls).toEqual([
      { sessionID: "test-session", prompt: "ship it", ultrawork: true },
    ])
    expect(stopContinuationGuard.isStoppedCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.clearCalls).toEqual(["test-session"])
  })

  test("clears stop state before raw /ralph-loop resumes work through chat.message", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const startLoopCalls: Array<{ sessionID: string; prompt: string; ultrawork: boolean }> = []
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: { ultrawork?: boolean }) => {
        startLoopCalls.push({ sessionID, prompt, ultrawork: options?.ultrawork === true })
        return true
      },
      cancelLoop: () => true,
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/ralph-loop keep going" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(startLoopCalls).toEqual([
      { sessionID: "test-session", prompt: "keep going", ultrawork: false },
    ])
    expect(stopContinuationGuard.isStoppedCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.clearCalls).toEqual(["test-session"])
  })

  test("does not clear stop state for ordinary stopped chat messages", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const startWorkCalls: string[] = []
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.startWork = {
      "chat.message": async (input: { sessionID: string }) => {
        startWorkCalls.push(input.sessionID)
      },
    }
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "continue helping with this bug" }],
    })

    // then
    expect(startWorkCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toHaveLength(0)
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })

  test("does not clear stop state when the session was not stopped", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(false)
    const startWorkCalls: string[] = []
    const startLoopCalls: Array<{ sessionID: string; prompt: string; ultrawork: boolean }> = []
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.startWork = {
      "chat.message": async (input: { sessionID: string }) => {
        startWorkCalls.push(input.sessionID)
      },
    }
    args.hooks.ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: { ultrawork?: boolean }) => {
        startLoopCalls.push({ sessionID, prompt, ultrawork: options?.ultrawork === true })
        return true
      },
      cancelLoop: () => true,
    }
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: createStartWorkTemplateOutput().parts,
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/ulw-loop continue" }],
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/ralph-loop continue" }],
    })

    // then
    expect(startWorkCalls).toEqual([
      "test-session",
      "test-session",
      "test-session",
    ])
    expect(startLoopCalls).toEqual([
      { sessionID: "test-session", prompt: "continue", ultrawork: true },
      { sessionID: "test-session", prompt: "continue", ultrawork: false },
    ])
    expect(stopContinuationGuard.isStoppedCalls).toEqual([
      "test-session",
      "test-session",
      "test-session",
    ])
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })
})

describe("createChatMessageHandler - /ulw-loop raw slash fallback", () => {
  test("starts ultrawork loop when /ulw-loop arrives through chat.message without native command expansion", async () => {
    // given
    const startLoopCalls: Array<{
      sessionID: string
      prompt: string
      options: Record<string, unknown>
    }> = []
    const args = createMockHandlerArgs()
    args.hooks.autoSlashCommand = createAutoSlashCommandHook({ skills: [] })
    args.hooks.ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>) => {
        startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
        return true
      },
      cancelLoop: () => true,
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: '/ulw-loop "Ship feature" --strategy=continue' }],
    }

    // when
    await handler(input, output)

    // then
    expect(startLoopCalls).toEqual([
      {
        sessionID: "test-session",
        prompt: "Ship feature",
        options: {
          ultrawork: true,
          maxIterations: undefined,
          completionPromise: undefined,
          strategy: "continue",
        },
      },
    ])
  })

  test("starts ultrawork loop when injected messages appear before the raw /ulw-loop command", async () => {
    // given
    const startLoopCalls: Array<{
      sessionID: string
      prompt: string
      options: Record<string, unknown>
    }> = []
    const args = createMockHandlerArgs()
    args.hooks.ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>) => {
        startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
        return true
      },
      cancelLoop: () => true,
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [
        {
          type: "text",
          text: "[BACKGROUND TASK COMPLETED]\nPlan finished.\n\n---\n\n/ulw-loop \"Ship feature\" --strategy=continue",
        },
      ],
    }

    // when
    await handler(input, output)

    // then
    expect(startLoopCalls).toEqual([
      {
        sessionID: "test-session",
        prompt: "Ship feature",
        options: {
          ultrawork: true,
          maxIterations: undefined,
          completionPromise: undefined,
          strategy: "continue",
        },
      },
    ])
  })
})

describe("createChatMessageHandler - plain ultrawork keyword routing", () => {
  test("does not start ralph loop when plain ulw text flows through the full chat.message pipeline", async () => {
    // given
    setMainSession("test-session")
    const startLoopCalls: Array<{
      sessionID: string
      prompt: string
      options: Record<string, unknown>
    }> = []
    const ralphLoop = {
      startLoop: (sessionID: string, prompt: string, options?: Record<string, unknown>) => {
        startLoopCalls.push({ sessionID, prompt, options: options ?? {} })
        return true
      },
      cancelLoop: () => true,
    }
    const args = createMockHandlerArgs()
    args.hooks.ralphLoop = ralphLoop
    args.hooks.keywordDetector = createKeywordDetectorHook(args.ctx as never, undefined, ralphLoop)
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "ulw fix the flaky keyword tests" }],
    }

    // when
    await handler(input, output)

    // then
    expect(startLoopCalls).toHaveLength(0)
    expect(output.parts[0]?.text).toContain("ULTRAWORK MODE ENABLED!")
    expect(output.parts[0]?.text).toContain("ulw fix the flaky keyword tests")
  })
})

function createMockInput(agent?: string, model?: { providerID: string; modelID: string }) {
  return {
    sessionID: "test-session",
    agent,
    model,
  }
}

function createMockOutput(variant?: string): ChatMessageHandlerOutput {
  const message: Record<string, unknown> = {}
  if (variant !== undefined) {
    message["variant"] = variant
  }
  return { message, parts: [] }
}

describe("createChatMessageHandler - TUI variant passthrough", () => {
  test("first message: does not override TUI variant when user has no selection", async () => {
    //#given - first message, no user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant set

    //#when
    await handler(input, output)

    //#then - TUI sent undefined, should stay undefined (no config override)
    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: preserves user-selected variant when already set", async () => {
    //#given - first message, user already selected "xhigh" variant in OpenCode UI
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh") // user selected xhigh

    //#when
    await handler(input, output)

    //#then - user's xhigh must be preserved
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: preserves TUI variant", async () => {
    //#given - not first message, variant already set
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: does not inject variant when TUI sends none", async () => {
    //#given - not first message, no variant from TUI
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant

    //#when
    await handler(input, output)

    //#then - should stay undefined, not auto-resolved from config
    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: marks gate as applied regardless of variant presence", async () => {
    //#given - first message with user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then - gate should still be marked as applied
    expect(args._appliedSessions).toContain("test-session")
  })

  test("injects queued background notifications through chat.message hook", async () => {
    //#given
    const args = createMockHandlerArgs()
    args.hooks.backgroundNotificationHook = {
      "chat.message": async (
        _input: { sessionID: string },
        output: ChatMessageHandlerOutput,
      ): Promise<void> => {
        output.parts.push({
          type: "text",
          text: "<system-reminder>[BACKGROUND TASK COMPLETED]</system-reminder>",
        })
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("[BACKGROUND TASK COMPLETED]")
  })

  test("reuses the stored model for subsequent messages in the main session when the UI sends none", async () => {
    //#given
    setMainSession("test-session")
    setSessionModel("test-session", { providerID: "openai", modelID: "gpt-5.4" })
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(getSessionModel("test-session")).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })

  test("does not reuse a stored model for the first message of a session", async () => {
    //#given
    setMainSession("test-session")
    setSessionModel("test-session", { providerID: "openai", modelID: "gpt-5.4" })
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toBeUndefined()
  })

  test("does not reuse the main-session model for subagent sessions", async () => {
    //#given
    setMainSession("main-session")
    setSessionModel("main-session", { providerID: "openai", modelID: "gpt-5.4" })
    subagentSessions.add("subagent-session")
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = {
      sessionID: "subagent-session",
      agent: "oracle",
    }
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toBeUndefined()
    expect(getSessionModel("subagent-session")).toBeUndefined()
  })

  test("does not override explicit agent model overrides with stored session model", async () => {
    //#given
    setMainSession("test-session")
    setSessionModel("test-session", { providerID: "openai", modelID: "gpt-5.4" })
    const args = createMockHandlerArgs({
      shouldOverride: false,
      pluginConfig: {
        agents: {
          sisyphus: { model: "anthropic/claude-opus-4-6" },
        },
      },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toBeUndefined()
    expect(getSessionModel("test-session")).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })

  test("treats prefixed list-display agent names as explicit model overrides", async () => {
    //#given
    setMainSession("test-session")
    setSessionModel("test-session", { providerID: "openai", modelID: "gpt-5.4" })
    const args = createMockHandlerArgs({
      shouldOverride: false,
      pluginConfig: {
        agents: {
          prometheus: { model: "anthropic/claude-opus-4-6" },
        },
      },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput(getAgentListDisplayName("prometheus"))
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toBeUndefined()
    expect(getSessionModel("test-session")).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(getSessionAgent("test-session")).toBe("Prometheus - Plan Builder")
  })

  test("respects a mid-conversation model switch instead of reusing the previous stored model", async () => {
    //#given
    setMainSession("test-session")
    setSessionModel("test-session", { providerID: "anthropic", modelID: "claude-opus-4-6" })
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const nextModel = { providerID: "openai", modelID: "gpt-5.4" }
    const input = createMockInput("sisyphus", nextModel)
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["model"]).toBeUndefined()
    expect(getSessionModel("test-session")).toEqual(nextModel)
  })
})
