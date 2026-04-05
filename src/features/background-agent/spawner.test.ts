import { describe, test, expect, mock, afterEach } from "bun:test"
import { createTask, startTask } from "./spawner"
import type { BackgroundTask } from "./types"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"

describe("background-agent spawner agent-not-found fallback", () => {
  afterEach(() => {
    clearSessionPromptParams("session-fallback")
  })

  test("retries with 'general' agent when promptAsync fails with Agent not found", async () => {
    //#given
    const promptCalls: any[] = []
    let callCount = 0

    const client = {
      session: {
        get: async () => ({ data: { directory: "/tmp/test" } }),
        create: async () => ({ data: { id: "session-fallback" } }),
        promptAsync: async (args: any) => {
          callCount++
          promptCalls.push({ body: { ...args.body }, path: { ...args.path } })
          if (callCount === 1) {
            throw new Error('Agent not found: "Sisyphus-Junior". Available agents: build, explore, general, plan')
          }
          return { data: {} }
        },
      },
    } as any

    const onTaskError = mock(() => {})

    const task = createTask({
      description: "Implement feature",
      prompt: "Please implement the break-even analysis",
      agent: "Sisyphus-Junior",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
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
      directory: "/tmp/test",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError,
    }

    //#when
    await startTask(item as any, ctx as any)

    // Wait for the fire-and-forget prompt chain to settle
    await new Promise(resolve => setTimeout(resolve, 50))

    //#then
    // Should have called promptAsync twice: once with original agent, once with fallback
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0].body.agent).toBe("Sisyphus-Junior")
    expect(promptCalls[1].body.agent).toBe("general")
    // Original prompt content preserved in fallback
    expect(promptCalls[1].body.parts).toEqual(promptCalls[0].body.parts)
    // Tool restrictions recomputed for fallback agent (general has no restrictions)
    expect(promptCalls[1].body.tools).toEqual({
      task: false,
      call_omo_agent: true,
      question: false,
    })
    // Task agent identity updated to reflect fallback
    expect(task.agent).toBe("general")
    // Task should not have errored
    expect(onTaskError).not.toHaveBeenCalled()
  })

  test("does not retry for non-agent-not-found errors", async () => {
    //#given
    const promptCalls: any[] = []

    const client = {
      session: {
        get: async () => ({ data: { directory: "/tmp/test" } }),
        create: async () => ({ data: { id: "session-fallback" } }),
        promptAsync: async (args: any) => {
          promptCalls.push(args)
          throw new Error("Connection timeout")
        },
      },
    } as any

    const onTaskError = mock(() => {})

    const task = createTask({
      description: "Implement feature",
      prompt: "Do work",
      agent: "Sisyphus-Junior",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
      },
    }

    const ctx = {
      client,
      directory: "/tmp/test",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError,
    }

    //#when
    await startTask(item as any, ctx as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    //#then
    // Only one attempt — no retry for non-agent errors
    expect(promptCalls).toHaveLength(1)
    expect(onTaskError).toHaveBeenCalled()
  })

  test("calls onTaskError if fallback agent also fails", async () => {
    //#given
    let callCount = 0
    const client = {
      session: {
        get: async () => ({ data: { directory: "/tmp/test" } }),
        create: async () => ({ data: { id: "session-fallback" } }),
        promptAsync: async () => {
          callCount++
          throw new Error('Agent not found: "Sisyphus-Junior". Available agents: build, explore, general, plan')
        },
      },
    } as any

    const onTaskError = mock(() => {})

    const task = createTask({
      description: "Implement feature",
      prompt: "Do work",
      agent: "Sisyphus-Junior",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
    })

    const item = {
      task,
      input: {
        description: task.description,
        prompt: task.prompt,
        agent: task.agent,
        parentSessionID: task.parentSessionID,
        parentMessageID: task.parentMessageID,
      },
    }

    const ctx = {
      client,
      directory: "/tmp/test",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError,
    }

    //#when
    await startTask(item as any, ctx as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    //#then
    // Verify retry was attempted (2 calls: original + fallback)
    expect(callCount).toBe(2)
    expect(onTaskError).toHaveBeenCalled()
  })

  test("retries on agent.name/undefined error variant", async () => {
    //#given
    const promptCalls: any[] = []
    let callCount = 0

    const client = {
      session: {
        get: async () => ({ data: { directory: "/tmp/test" } }),
        create: async () => ({ data: { id: "session-fallback" } }),
        promptAsync: async (args: any) => {
          callCount++
          promptCalls.push({ body: { ...args.body } })
          if (callCount === 1) {
            throw new Error("Cannot read properties of undefined (reading 'agent.name')")
          }
          return { data: {} }
        },
      },
    } as any

    const onTaskError = mock(() => {})

    const task = createTask({
      description: "Test task",
      prompt: "Do work",
      agent: "Sisyphus-Junior",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
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
      directory: "/tmp/test",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError,
    }

    //#when
    await startTask(item as any, ctx as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    //#then
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0].body.agent).toBe("Sisyphus-Junior")
    expect(promptCalls[1].body.agent).toBe("general")
    expect(onTaskError).not.toHaveBeenCalled()
  })

  test("detects agent error from plain object with message field", async () => {
    //#given
    const promptCalls: any[] = []
    let callCount = 0

    const client = {
      session: {
        get: async () => ({ data: { directory: "/tmp/test" } }),
        create: async () => ({ data: { id: "session-fallback" } }),
        promptAsync: async (args: any) => {
          callCount++
          promptCalls.push({ body: { ...args.body } })
          if (callCount === 1) {
            throw { message: 'Agent not found: "Custom-Agent"', name: "UnknownError" }
          }
          return { data: {} }
        },
      },
    } as any

    const onTaskError = mock(() => {})

    const task = createTask({
      description: "Test task",
      prompt: "Do work",
      agent: "Custom-Agent",
      parentSessionID: "ses_parent",
      parentMessageID: "msg_parent",
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
      directory: "/tmp/test",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError,
    }

    //#when
    await startTask(item as any, ctx as any)
    await new Promise(resolve => setTimeout(resolve, 50))

    //#then
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[1].body.agent).toBe("general")
    expect(onTaskError).not.toHaveBeenCalled()
  })
})

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
