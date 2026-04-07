import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { createChatMessageHandler } from "./chat-message"
import { createAutoSlashCommandHook } from "../hooks/auto-slash-command"
import { createStartWorkHook } from "../hooks/start-work"
import { readBoulderState } from "../features/boulder-state"
import { _resetForTesting, setMainSession, subagentSessions, registerAgentName, updateSessionAgent, getSessionAgent } from "../features/claude-code-session-state"
import { getAgentListDisplayName } from "../shared/agent-display-names"
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }

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
