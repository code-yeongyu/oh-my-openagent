import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig } from "../config"
import { readBoulderState } from "../features/boulder-state"
import { _resetForTesting, getSessionAgent, registerAgentName, setMainSession, subagentSessions, updateSessionAgent } from "../features/claude-code-session-state"
import { createAutoSlashCommandHook } from "../hooks/auto-slash-command"
import { createStartWorkHook } from "../hooks/start-work"
import { getAgentListDisplayName } from "../shared/agent-display-names"
import { getOmoOpenCodeCacheDir, getOpenCodeCacheDir } from "../shared/data-path"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../shared/internal-initiator-marker"
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state"
import { createChatMessageHandler } from "./chat-message"
import { MAX_OBJECTIVE_LENGTH, validateObjective } from "../hooks/goal/validation"
import type { PluginContext } from "./types"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
type ChatMessageHandlerArgs = Parameters<typeof createChatMessageHandler>[0]
type MockHandlerArgs = ChatMessageHandlerArgs & { readonly _appliedSessions: string[] }

function createStartWorkTemplateOutput(): ChatMessageHandlerOutput {
  return {
    message: {},
    parts: [
      {
        type: "text",
        text: `<session-context>context</session-context>\nYou are starting an Atlas work session.`,
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

function createGoalHookMock() {
  const setGoalCalls: Array<{ sessionID: string; objective: string }> = []
  const pauseGoalCalls: string[] = []
  const resumeGoalCalls: string[] = []
  const clearGoalCalls: string[] = []

  return {
    hook: {
      setGoal: (sessionID: string, objective: string) => {
        setGoalCalls.push({ sessionID, objective })
        return { objective, status: "active" }
      },
      getGoal: () => null,
      pauseGoal: (sessionID: string) => {
        pauseGoalCalls.push(sessionID)
        return { objective: "", status: "paused" }
      },
      resumeGoal: (sessionID: string) => {
        resumeGoalCalls.push(sessionID)
        return { objective: "", status: "active" }
      },
      clearGoal: (sessionID: string) => {
        clearGoalCalls.push(sessionID)
        return true
      },
      markComplete: () => null,
    },
    setGoalCalls,
    pauseGoalCalls,
    resumeGoalCalls,
    clearGoalCalls,
  }
}

function createMockHandlerArgs(overrides?: {
  pluginConfig?: Record<string, unknown>
  shouldOverride?: boolean
}): MockHandlerArgs {
  const appliedSessions: string[] = []
  return {
    ctx: unsafeTestValue<PluginContext>({
      client: { tui: { showToast: async () => {} } },
    }),
    pluginConfig: unsafeTestValue<OhMyOpenCodeConfig>((overrides?.pluginConfig ?? {})),
    firstMessageVariantGate: {
      shouldOverride: () => overrides?.shouldOverride ?? false,
      markApplied: (sessionID: string) => { appliedSessions.push(sessionID) },
    },
    hooks: unsafeTestValue<ChatMessageHandlerArgs["hooks"]>({
      stopContinuationGuard: null,
      backgroundNotificationHook: null,
      keywordDetector: null,
      claudeCodeHooks: null,
      autoSlashCommand: null,
      startWork: null,
      goal: null,
    }),
    _appliedSessions: appliedSessions,
  }
}

afterEach(() => {
  _resetForTesting()
  clearSessionModel("test-session")
  clearSessionModel("main-session")
  clearSessionModel("subagent-session")
})

describe("createChatMessageHandler - synthetic/internal messages", () => {
  test("skips synthetic-only user messages before session state and hooks mutate", async () => {
    // given
    const hookCalls: string[] = []
    const args = createMockHandlerArgs({ shouldOverride: true })
    args.hooks.keywordDetector = {
      "chat.message": async () => {
        hookCalls.push("keywordDetector")
      },
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "synthetic prompt", synthetic: true }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(args._appliedSessions).toEqual([])
    expect(hookCalls).toEqual([])
    expect(getSessionAgent("test-session")).toBeUndefined()
  })

  test("skips internally marked user messages before first-message gate is consumed", async () => {
    // given
    const hookCalls: string[] = []
    const args = createMockHandlerArgs({ shouldOverride: true })
    args.hooks.autoSlashCommand = {
      "chat.message": async () => {
        hookCalls.push("autoSlashCommand")
      },
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: `/commit\n${OMO_INTERNAL_INITIATOR_MARKER}` }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(args._appliedSessions).toEqual([])
    expect(hookCalls).toEqual([])
    expect(getSessionAgent("test-session")).toBeUndefined()
  })
})

describe("createChatMessageHandler - first message hook ordering", () => {
  test("updates session agent and marks the first-message gate before chat hooks run", async () => {
    // given
    const hookObservations: Array<{
      readonly hook: string
      readonly agent: string | undefined
      readonly appliedSessions: readonly string[]
    }> = []
    const args = createMockHandlerArgs({ shouldOverride: true })
    args.hooks.stopContinuationGuard = {
      "chat.message": async (input: { sessionID: string }) => {
        hookObservations.push({
          hook: "stopContinuationGuard",
          agent: getSessionAgent(input.sessionID),
          appliedSessions: [...args._appliedSessions],
        })
      },
      stop: () => {},
      isStopped: () => false,
      clear: () => {},
    }
    args.hooks.keywordDetector = {
      "chat.message": async (input: { sessionID: string }) => {
        hookObservations.push({
          hook: "keywordDetector",
          agent: getSessionAgent(input.sessionID),
          appliedSessions: [...args._appliedSessions],
        })
      },
    }
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "ship it" }],
    })

    // then
    expect(hookObservations).toEqual([
      {
        hook: "stopContinuationGuard",
        agent: "sisyphus",
        appliedSessions: ["test-session"],
      },
      {
        hook: "keywordDetector",
        agent: "sisyphus",
        appliedSessions: ["test-session"],
      },
    ])
  })

  test("skips model fallback when runtime fallback is enabled", async () => {
    // given
    const hookCalls: string[] = []
    const args = createMockHandlerArgs({
      pluginConfig: { runtime_fallback: { enabled: true } },
    })
    args.hooks.modelFallback = {
      "chat.message": async () => {
        hookCalls.push("modelFallback")
      },
    }
    args.hooks.runtimeFallback = {
      "chat.message": async () => {
        hookCalls.push("runtimeFallback")
      },
    }
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "hello" }],
    })

    // then
    expect(hookCalls).toEqual(["runtimeFallback"])
  })
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
    mkdirSync(join(testDir, ".omo", "plans"), { recursive: true })
    writeFileSync(join(testDir, ".omo", "plans", "worker-plan.md"), "# Plan\n- [ ] Task 1")
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
    writeFileSync(join(testDir, ".omo", "plans", "my-feature-plan.md"), "# Plan\n- [ ] Task 1")
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

describe("createChatMessageHandler - goal command handling and stop continuation clearing", () => {
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

  test("does not clear stop state for /goal <objective>", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal Ship it" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(goalMock.setGoalCalls).toEqual([{ sessionID: "test-session", objective: "Ship it" }])
    expect(stopContinuationGuard.isStoppedCalls).toHaveLength(0)
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })

  test("does not clear stop state for /goal pause", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal pause" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(goalMock.pauseGoalCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toHaveLength(0)
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })

  test("does not clear stop state for /goal resume", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal resume" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(goalMock.resumeGoalCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toHaveLength(0)
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })

  test("does not clear stop state for /goal clear", async () => {
    // given
    const stopContinuationGuard = createStopContinuationGuardMock(true)
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal clear" }],
    }

    // when
    await handler(createMockInput("sisyphus"), output)

    // then
    expect(goalMock.clearGoalCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toHaveLength(0)
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
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
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.stopContinuationGuard = stopContinuationGuard.guard
    args.hooks.startWork = {
      "chat.message": async (input: { sessionID: string }) => {
        startWorkCalls.push(input.sessionID)
      },
    }
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)

    // when
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: createStartWorkTemplateOutput().parts,
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/goal Ship it" }],
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/goal pause" }],
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/goal resume" }],
    })
    await handler(createMockInput("sisyphus"), {
      message: {},
      parts: [{ type: "text", text: "/goal clear" }],
    })

    // then
    expect(startWorkCalls).toEqual([
      "test-session",
      "test-session",
      "test-session",
      "test-session",
      "test-session",
    ])
    expect(goalMock.setGoalCalls).toEqual([
      { sessionID: "test-session", objective: "Ship it" },
    ])
    expect(goalMock.pauseGoalCalls).toEqual(["test-session"])
    expect(goalMock.resumeGoalCalls).toEqual(["test-session"])
    expect(goalMock.clearGoalCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.isStoppedCalls).toEqual(["test-session"])
    expect(stopContinuationGuard.clearCalls).toHaveLength(0)
  })
})

describe("createChatMessageHandler - /goal raw slash fallback", () => {
  test("sets goal when /goal <objective> arrives through chat.message without native command expansion", async () => {
    // given
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal Ship the dashboard" }],
    }

    // when
    await handler(input, output)

    // then
    expect(goalMock.setGoalCalls).toEqual([
      { sessionID: "test-session", objective: "Ship the dashboard" },
    ])
  })

  test("pauses goal when /goal pause arrives", async () => {
    // given
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal pause" }],
    }

    // when
    await handler(input, output)

    // then
    expect(goalMock.pauseGoalCalls).toEqual(["test-session"])
    expect(goalMock.setGoalCalls).toHaveLength(0)
  })

  test("resumes goal when /goal resume arrives", async () => {
    // given
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal resume" }],
    }

    // when
    await handler(input, output)

    // then
    expect(goalMock.resumeGoalCalls).toEqual(["test-session"])
    expect(goalMock.setGoalCalls).toHaveLength(0)
  })

  test("clears goal when /goal clear arrives", async () => {
    // given
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal clear" }],
    }

    // when
    await handler(input, output)

    // then
    expect(goalMock.clearGoalCalls).toEqual(["test-session"])
    expect(goalMock.setGoalCalls).toHaveLength(0)
  })

  test("default goal auto-starts on first message when default_mode.goal is enabled", async () => {
    // given
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs({
      shouldOverride: true,
      pluginConfig: { default_mode: { goal: true } },
    })
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "Ship the dashboard" }],
    }

    // when
    await handler(input, output)

    // then
    expect(goalMock.setGoalCalls).toEqual([
      { sessionID: "test-session", objective: "Ship the dashboard" },
    ])
  })

  test("does not abort the message when the first message exceeds the objective limit", async () => {
    // given: setGoal validates like the real controller, throwing for over-limit objectives
    const goalMock = createGoalHookMock()
    const recordingSetGoal = goalMock.hook.setGoal
    goalMock.hook.setGoal = (sessionID: string, objective: string) => {
      validateObjective(objective)
      return recordingSetGoal(sessionID, objective)
    }
    const args = createMockHandlerArgs({
      shouldOverride: true,
      pluginConfig: { default_mode: { goal: true } },
    })
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const input = createMockInput("sisyphus")
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "x".repeat(MAX_OBJECTIVE_LENGTH + 500) }],
    }

    // when / then: the over-limit first message must still send (no throw); goal is skipped
    await expect(handler(input, output)).resolves.toBeUndefined()
    expect(goalMock.setGoalCalls).toHaveLength(0)
  })

})

describe("createChatMessageHandler - goal handling uses the raw prompt", () => {
  test("sets the goal from /goal even after autoSlashCommand rewrites the message part", async () => {
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    args.hooks.autoSlashCommand = {
      "chat.message": async (_input: { sessionID: string }, output: ChatMessageHandlerOutput) => {
        const part = output.parts[0]
        if (part && typeof part.text === "string" && part.text.trimStart().startsWith("/goal")) {
          part.text = "<auto-slash-command>\nexpanded goal template\n</auto-slash-command>"
        }
      },
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal Ship it" }],
    }

    await handler(createMockInput("sisyphus"), output)

    expect(goalMock.setGoalCalls).toEqual([{ sessionID: "test-session", objective: "Ship it" }])
  })

  test("auto-starts the goal from the RAW first message even when a hook wraps it", async () => {
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs({
      shouldOverride: true,
      pluginConfig: { default_mode: { goal: true } },
    })
    args.hooks.goal = goalMock.hook
    args.hooks.keywordDetector = {
      "chat.message": async (_input: { sessionID: string }, output: ChatMessageHandlerOutput) => {
        const part = output.parts[0]
        if (part && typeof part.text === "string") {
          part.text = `<session-context>injected</session-context>\n${part.text}`
        }
      },
    }
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "Ship the dashboard" }],
    }

    await handler(createMockInput("sisyphus"), output)

    expect(goalMock.setGoalCalls).toEqual([{ sessionID: "test-session", objective: "Ship the dashboard" }])
  })

  test("preserves a multi-line /goal objective", async () => {
    const goalMock = createGoalHookMock()
    const args = createMockHandlerArgs()
    args.hooks.goal = goalMock.hook
    const handler = createChatMessageHandler(args)
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: "/goal Fix these:\n1. First\n2. Second" }],
    }

    await handler(createMockInput("sisyphus"), output)

    expect(goalMock.setGoalCalls).toEqual([{ sessionID: "test-session", objective: "Fix these:\n1. First\n2. Second" }])
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.5" })
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
          sisyphus: { model: "anthropic/claude-opus-4-7" },
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
          prometheus: { model: "anthropic/claude-opus-4-7" },
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
    setSessionModel("test-session", { providerID: "anthropic", modelID: "claude-opus-4-7" })
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

  test("strips legacy ZWSP-prefixed agent names from persisted prompt body session state (GH-3259)", async () => {
    //#given - persisted prompt body from v3.14.0-v3.16.0 may contain ZWSP-prefixed agent
    const args = createMockHandlerArgs()
    const handler = createChatMessageHandler(args)
    const input = createMockInput("\u200B\u200BHephaestus - Deep Agent")
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(getSessionAgent("test-session")).toBe("Hephaestus - Deep Agent")
  })
})
