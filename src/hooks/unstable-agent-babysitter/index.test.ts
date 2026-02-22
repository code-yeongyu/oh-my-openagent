import { afterEach, describe, expect, test } from "bun:test"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
import type { BackgroundTask } from "../../features/background-agent"
import { createUnstableAgentBabysitterHook } from "./index"

const projectDir = process.cwd()

type BabysitterContext = Parameters<typeof createUnstableAgentBabysitterHook>[0]

function createMockPluginInput(options: {
  messagesBySession: Record<string, unknown[]>
  promptCalls: Array<{ input: unknown }>
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
    sessionID: "bg-1",
    parentSessionID: "main-1",
    parentMessageID: "msg-1",
    description: "unstable task",
    prompt: "run work",
    agent: "test-agent",
    status: "running",
    progress: {
      toolCalls: 1,
      lastUpdate: new Date(),
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
})
