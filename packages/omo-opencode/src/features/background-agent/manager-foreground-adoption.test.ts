import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createManager(): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      status: async () => ({ data: {} }),
      get: async () => ({ data: { id: "ses" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }
  const ctx: PluginInput = {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as unknown as PluginInput["client"],
  } as PluginInput
  return new BackgroundManager({ pluginContext: ctx, config: undefined, enableParentSessionNotifications: false })
}

const ORIGINAL_START = new Date(Date.now() - 10 * 60_000)

describe("BackgroundManager.adoptForegroundSession", () => {
  test("#given a session the manager does not know #when it is adopted #then it runs as a background task under the given id", async () => {
    // given
    const manager = createManager()

    try {
      // when
      const task = await manager.adoptForegroundSession({
        taskId: "sync_ses_abcd",
        sessionId: "ses_abcd1234",
        parentSessionId: "ses_parent",
        description: "long task",
        agent: "explore",
        wake: "none",
        startedAt: ORIGINAL_START,
      })

      // then
      expect(task.id).toBe("sync_ses_abcd")
      expect(task.status).toBe("running")
      expect(task.wake).toBe("none")
      expect(manager.getTask("sync_ses_abcd")?.sessionId).toBe("ses_abcd1234")
      expect(task.startedAt).toEqual(ORIGINAL_START)
    } finally {
      manager.shutdown()
    }
  })

  test("#given the session already has a finished task record #when it is adopted #then that record runs again rather than a second one", async () => {
    // given
    const manager = createManager()
    const finished: BackgroundTask = {
      id: "bg_old",
      sessionId: "ses_cont1234",
      parentSessionId: "ses_old_parent",
      parentMessageId: "msg",
      description: "earlier",
      prompt: "p",
      agent: "explore",
      status: "completed",
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(Date.now() - 30_000),
    }
    manager["tasks"].set(finished.id, finished)

    try {
      // when
      const task = await manager.adoptForegroundSession({
        taskId: "resume_sync_ses_cont",
        sessionId: "ses_cont1234",
        parentSessionId: "ses_parent",
        description: "continued",
        agent: "explore",
        wake: "each",
        startedAt: ORIGINAL_START,
      })

      // then
      expect(task.id).toBe("bg_old")
      expect(task.status).toBe("running")
      expect(task.completedAt).toBeUndefined()
      expect(task.startedAt).toEqual(ORIGINAL_START)
      expect(task.parentSessionId).toBe("ses_parent")
      expect(manager.getTask("resume_sync_ses_cont")).toBeUndefined()
    } finally {
      manager.shutdown()
    }
  })
})
