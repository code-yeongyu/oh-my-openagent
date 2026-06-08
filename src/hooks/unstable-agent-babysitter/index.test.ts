import { afterEach, describe, expect, test } from "bun:test"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import type { BackgroundTask } from "../../features/background-agent"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import {
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"
import { createUnstableAgentBabysitterHook } from "./index"

const projectDir = process.cwd()

type BabysitterContext = Parameters<typeof createUnstableAgentBabysitterHook>[0]

function createMockPluginInput(options: {
  messagesBySession: Record<string, unknown[]>
  promptCalls: Array<{ input: unknown }>
  promptAsyncImpl?: (input: unknown) => Promise<unknown>
}): BabysitterContext {
  const { messagesBySession, promptCalls } = options
  return {
    directory: projectDir,
    client: {
      session: {
        messages: async ({ path }: { path: { id: string } }) => ({
          data: messagesBySession[path.id] ?? [],
        }),
        prompt: async (input: unknown) => {
          promptCalls.push({ input })
        },
        promptAsync: async (input: unknown) => {
          promptCalls.push({ input })
          if (options.promptAsyncImpl) {
            return options.promptAsyncImpl(input)
          }
        },
      },
    },
  }
}

function createBackgroundManager(tasks: BackgroundTask[]) {
  return {
    getTasksByParentSession: () => tasks,
  }
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "bg-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "unstable task",
    prompt: "run work",
    agent: "test-agent",
    status: "running",
    progress: {
      toolCalls: 1,
      lastUpdate: new Date(Date.now() - 121000),
      lastMessage: "still working",
      lastMessageAt: new Date(Date.now() - 121000),
    },
    model: { providerID: "google", modelID: "gemini-1.5" },
    ...overrides,
  }
}

describe("unstable-agent-babysitter hook", () => {
  afterEach(() => {
    _resetForTesting()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("settles idle before injecting a reminder", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-4" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
      idleSettleMs: 50,
    })

    // #when
    const startedAt = Date.now()
    const eventPromise = hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
    await Promise.resolve()

    // #then
    expect(promptCalls.length).toBe(0)

    await eventPromise
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45)
    expect(promptCalls.length).toBe(1)
  })

  test("fires reminder for hung gemini task", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-4" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // #when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // #then
    expect(promptCalls.length).toBe(1)
    const payload = promptCalls[0].input as { body?: { parts?: Array<{ text?: string }> } }
    const text = payload.body?.parts?.[0]?.text ?? ""
    expect(text).toContain("background_output")
    expect(text).toContain("background_cancel")
    expect(text).toContain("deep thought")
    expect(text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })

  test("fires reminder for hung minimax task", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-4" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "minimax thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([
      createTask({ model: { providerID: "minimax", modelID: "minimax-1" } }),
    ])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // #when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // #then
    expect(promptCalls.length).toBe(1)
    const payload = promptCalls[0].input as { body?: { parts?: Array<{ text?: string }> } }
    const text = payload.body?.parts?.[0]?.text ?? ""
    expect(text).toContain("background_output")
    expect(text).toContain("background_cancel")
    expect(text).toContain("minimax thought")
    expect(text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })

  test("does not remind stable model tasks", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([
      createTask({ model: { providerID: "openai", modelID: "gpt-4" } }),
    ])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // #when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // #then
    expect(promptCalls.length).toBe(0)
  })

  test("respects per-task cooldown", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })
    const now = Date.now()
    const originalNow = Date.now
    Date.now = () => now

    // #when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // #then
    expect(promptCalls.length).toBe(1)
    Date.now = originalNow
  })

  test("#given reminder prompt may have been accepted before EOF #when the main session idles again inside cooldown #then no duplicate reminder is injected", async () => {
    // #given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const now = Date.now()
    const originalNow = Date.now
    Date.now = () => now
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-4" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
      promptAsyncImpl: async () => {
        throw new Error("JSON Parse error: Unexpected EOF")
      },
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // #when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
      releasePromptAsyncReservation("main-1", "test:simulate-expired-hold", {
        reservedBy: "unstable-agent-babysitter",
      })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // #then
      expect(promptCalls.length).toBe(1)
    } finally {
      Date.now = originalNow
    }
  })

  test("skips follow-up reminder after the main session is cancelled", async () => {
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-4" } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })
    const firstNow = Date.now()
    const originalNow = Date.now
    let currentNow = firstNow
    Date.now = () => currentNow

    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
    await hook.event({ event: { type: "session.error", properties: { sessionID: "main-1", error: { name: "AbortError" } } } })
    currentNow += 5 * 60 * 1000 + 1
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    expect(promptCalls.length).toBe(1)
    Date.now = originalNow
  })

  test("#given the main session model includes variant #when injecting a babysitter reminder #then promptAsync receives variant as a top-level field", async () => {
    // given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const mainModel = {
      providerID: "openai",
      modelID: "gpt-4",
      variant: "max",
    }
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { agent: "sisyphus", model: mainModel } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask()])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // then
    expect(promptCalls.length).toBe(1)
    const payload = promptCalls[0].input as {
      body?: {
        model?: { providerID: string; modelID: string }
        variant?: string
      }
    }
    expect(payload.body?.model).toEqual({ providerID: "openai", modelID: "gpt-4" })
    expect(payload.body?.variant).toBe("max")
  })

  test("#given the main session has a fresh user message #when it becomes idle #then babysitter does not inject a reminder", async () => {
    // given
    const originalNow = Date.now
    Date.now = () => 10 * 60 * 1000
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { role: "user", time: { created: Date.now() - 1_500 } } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(0),
        lastMessage: "still working",
        lastMessageAt: new Date(0),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(0)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given the latest main-session assistant output has finished after a fresh user message #when it becomes idle #then babysitter may inject a reminder", async () => {
    // given
    const originalNow = Date.now
    Date.now = () => 10 * 60 * 1000
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { role: "user", time: { created: Date.now() - 1_500 } } },
          { info: { role: "assistant", time: { created: Date.now() - 500 }, agent: "sisyphus", finish: "stop" } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(0),
        lastMessage: "still working",
        lastMessageAt: new Date(0),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(1)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given the latest main-session assistant output is still streaming after a fresh user message #when it becomes idle #then babysitter does not inject a reminder", async () => {
    // given
    const originalNow = Date.now
    Date.now = () => 10 * 60 * 1000
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: {
        "main-1": [
          { info: { role: "user", time: { created: Date.now() - 1_500 } } },
          { info: { role: "assistant", time: { created: Date.now() - 500 }, agent: "sisyphus" } },
        ],
        "bg-1": [
          { info: { role: "assistant" }, parts: [{ type: "thinking", thinking: "deep thought" }] },
        ],
      },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(0),
        lastMessage: "still working",
        lastMessageAt: new Date(0),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(0)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given an unstable task has a fresh progress update after its last message #when the main session idles #then babysitter does not treat it as hung", async () => {
    // given
    const originalNow = Date.now
    Date.now = () => 10 * 60 * 1000
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 1_000),
        lastMessage: "still working",
        lastMessageAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(0)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given an unstable task has stale progress and stale last message #when the main session idles #then babysitter still reminds", async () => {
    // given
    const originalNow = Date.now
    Date.now = () => 10 * 60 * 1000
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 5 * 60 * 1000),
        lastMessage: "still working",
        lastMessageAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(1)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given a reminder was already sent before an abort #when a user message resumes the session within cooldown #then no duplicate reminder is injected", async () => {
    // given
    const originalNow = Date.now
    let currentNow = 10 * 60 * 1000
    Date.now = () => currentNow
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(0),
        lastMessage: "still working",
        lastMessageAt: new Date(0),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
      await hook.event({ event: { type: "session.error", properties: { sessionID: "main-1", error: { name: "AbortError" } } } })
      currentNow += 1_000
      await hook.event({ event: { type: "message.updated", properties: { sessionID: "main-1", info: { role: "user" } } } })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(1)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given a reminder was already sent before a stop event #when assistant activity resumes within cooldown #then no duplicate reminder is injected", async () => {
    // given
    const originalNow = Date.now
    let currentNow = 10 * 60 * 1000
    Date.now = () => currentNow
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(0),
        lastMessage: "still working",
        lastMessageAt: new Date(0),
      },
    })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    try {
      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })
      await hook.event({ event: { type: "session.stop", properties: { sessionID: "main-1" } } })
      currentNow += 1_000
      await hook.event({ event: { type: "message.updated", properties: { sessionID: "main-1", info: { role: "assistant" } } } })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

      // then
      expect(promptCalls.length).toBe(1)
    } finally {
      Date.now = originalNow
    }
  })

  test("#given unstable task agent is a config key #when babysitter builds a reminder #then the reminder uses the canonical display name", async () => {
    // given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({ agent: "sisyphus" })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // then
    const payload = promptCalls[0]?.input as { body?: { parts?: Array<{ text?: string }> } } | undefined
    const text = payload?.body?.parts?.[0]?.text ?? ""
    expect(text).toContain("Agent: Sisyphus - ultraworker")
    expect(text).not.toContain("Agent: sisyphus")
  })

  test("#given unstable task agent is a legacy display name #when babysitter builds a reminder #then the reminder uses the current display name", async () => {
    // given
    setMainSession("main-1")
    const promptCalls: Array<{ input: unknown }> = []
    const ctx = createMockPluginInput({
      messagesBySession: { "main-1": [], "bg-1": [] },
      promptCalls,
    })
    const backgroundManager = createBackgroundManager([createTask({ agent: "Sisyphus (Ultraworker)" })])
    const hook = createUnstableAgentBabysitterHook(ctx, {
      backgroundManager,
      config: { timeout_ms: 120000 },
    })

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: "main-1" } } })

    // then
    const payload = promptCalls[0]?.input as { body?: { parts?: Array<{ text?: string }> } } | undefined
    const text = payload?.body?.parts?.[0]?.text ?? ""
    expect(text).toContain("Agent: Sisyphus - ultraworker")
    expect(text).not.toContain("Agent: Sisyphus (Ultraworker)")
  })
})
