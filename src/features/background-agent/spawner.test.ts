import { describe, test, expect, mock, afterEach } from "bun:test"
import { createTask, startTask } from "./spawner"
import type { BackgroundTask } from "./types"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"

describe("background-agent spawner fallback model promotion", () => {
  afterEach(() => {
    clearSessionPromptParams("session-123")
  })

  test("passes promoted fallback model settings through supported prompt channels", async () => {
    //#given
    let promptArgs: any
    const client = {
      session: {
        get: mock(async () => ({ data: { directory: "/tmp/test" } })),
        create: mock(async () => ({ data: { id: "session-123" } })),
        promptAsync: mock(async (input: any) => {
          promptArgs = input
          return { data: {} }
        }),
      },
    } as any

    const concurrencyManager = {
      release: mock(() => {}),
    } as any

    const onTaskError = mock(() => {})

    const task: BackgroundTask = {
      id: "bg_test123",
      status: "pending",
      queuedAt: new Date(),
      description: "Test task",
      prompt: "Do the thing",
      agent: "oracle",
      parentSessionID: "parent-1",
      parentMessageID: "message-1",
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
        variant: "low",
        reasoningEffort: "high",
        temperature: 0.4,
        top_p: 0.7,
        maxTokens: 4096,
        thinking: { type: "disabled" },
      },
    }

    const input = {
      description: "Test task",
      prompt: "Do the thing",
      agent: "oracle",
      parentSessionID: "parent-1",
      parentMessageID: "message-1",
      model: task.model,
    }

    //#when
    await startTask(
      { task, input },
      {
        client,
        directory: "/tmp/test",
        concurrencyManager,
        tmuxEnabled: false,
        onTaskError,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    //#then
    expect(promptArgs.body.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    expect(promptArgs.body.variant).toBe("low")
    expect(promptArgs.body.options).toBeUndefined()
    expect(getSessionPromptParams("session-123")).toEqual({
      temperature: 0.4,
      topP: 0.7,
      options: {
        reasoningEffort: "high",
        thinking: { type: "disabled" },
        maxTokens: 4096,
      },
    })
  })

  test("keeps agent when explicit model is configured", async () => {
    //#given
    const promptCalls: any[] = []

    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent/dir" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async (args?: any) => {
          promptCalls.push(args)
          return {}
        },
      },
    }

    const task = createTask({
      description: "Test task",
      prompt: "Do work",
      agent: "sisyphus-junior",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
      model: { providerID: "openai", modelID: "gpt-5.4", variant: "medium" },
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
        parentModel: task.parentModel,
        parentAgent: task.parentAgent,
        model: task.model,
      },
    }

    const ctx = {
      client,
      directory: "/fallback",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError: () => {},
    }

    //#when
    await startTask(item as any, ctx as any)

    //#then
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.body?.agent).toBe("sisyphus-junior")
    expect(promptCalls[0]?.body?.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
    expect(promptCalls[0]?.body?.variant).toBe("medium")
  })
})
