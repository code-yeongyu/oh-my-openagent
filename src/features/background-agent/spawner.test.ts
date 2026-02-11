import { describe, test, expect } from "bun:test"

import { createTask, startTask } from "./spawner"

describe("background-agent spawner.startTask", () => {
  test("does not override parent session permission rules when creating child session", async () => {
    //#given
    const createCalls: any[] = []
    const parentPermission = [
      { permission: "question", action: "allow" as const, pattern: "*" },
      { permission: "plan_enter", action: "deny" as const, pattern: "*" },
    ]

    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent/dir", permission: parentPermission } }),
        create: async (args?: any) => {
          createCalls.push(args)
          return { data: { id: "ses_child" } }
        },
        promptAsync: async () => ({}),
      },
    }

    const task = createTask({
      description: "Test task",
      prompt: "Do work",
      agent: "explore",
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
      directory: "/fallback",
      concurrencyManager: { release: () => {} },
      tmuxEnabled: false,
      onTaskError: () => {},
    }

    //#when
    await startTask(item as any, ctx as any)

    //#then
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]?.body?.permission).toBeUndefined()
  })
})
