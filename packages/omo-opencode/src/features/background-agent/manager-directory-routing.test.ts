/// <reference types="bun-types" />

import { expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type TestManager = BackgroundManager & {
  readonly tasks: Map<string, BackgroundTask>
  readonly pollRunningTasks: () => Promise<void>
  readonly checkSessionTodos: (sessionID: string) => Promise<boolean>
}

function createTask(id: string, sessionId: string, directory: string): BackgroundTask {
  return {
    id,
    sessionId,
    parentSessionId: "",
    parentMessageId: "message",
    description: id,
    prompt: id,
    agent: "repository-reviewer",
    directory,
    status: "running",
    startedAt: new Date(),
  }
}

test("routes status polling once per distinct task directory", async () => {
  // given
  const status = mock(async (input?: { readonly query?: { readonly directory?: string } }) => ({
    data: input?.query?.directory === "/worktree/a"
      ? { "session-a": { type: "busy" } }
      : { "session-b": { type: "busy" } },
  }))
  const manager = new BackgroundManager({
    pluginContext: { client: { session: { status } }, directory: "/repository" } as PluginInput,
  }) as TestManager
  manager.tasks.set("a", createTask("a", "session-a", "/worktree/a"))
  manager.tasks.set("b", createTask("b", "session-b", "/worktree/b"))

  try {
    // when
    await manager.pollRunningTasks()

    // then
    expect(status.mock.calls.map(([input]) => input?.query?.directory).sort()).toEqual([
      "/worktree/a",
      "/worktree/b",
    ])
  } finally {
    await manager.shutdown()
  }
})

test("routes todo and abort endpoints through the task directory", async () => {
  // given
  const todo = mock(async () => ({ data: [] }))
  const abort = mock(async () => ({}))
  const manager = new BackgroundManager({
    pluginContext: { client: { session: { todo, abort } }, directory: "/repository" } as PluginInput,
  }) as TestManager
  const task = createTask("a", "session-a", "/worktree/a")
  manager.tasks.set(task.id, task)

  try {
    // when
    await manager.checkSessionTodos("session-a")
    await manager.cancelTask(task.id, { skipNotification: true })

    // then
    expect(todo).toHaveBeenCalledWith({
      path: { id: "session-a" },
      query: { directory: "/worktree/a" },
    })
    expect(abort).toHaveBeenCalledWith({
      path: { id: "session-a" },
      query: { directory: "/worktree/a" },
    })
  } finally {
    await manager.shutdown()
  }
})
