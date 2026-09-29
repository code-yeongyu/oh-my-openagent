/// <reference types="bun-types" />

import { describe, test, expect, mock } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_IDLE_TIME_MS } from "./constants"
import { MIN_SESSION_GONE_POLLS } from "./session-existence"
import type { BackgroundTask } from "./types"

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: {
      id: "test-project",
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function createManagerWithStatus(statusImpl: () => Promise<{ data: Record<string, { type: string }> }>): BackgroundManager {
  const client = {
    session: {
      status: statusImpl,
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }

  return new BackgroundManager({ pluginContext: createPluginContext(client) })
}

describe("BackgroundManager polling overlap", () => {
  test("skips overlapping pollRunningTasks executions", async () => {
    //#given
    let activeCalls = 0
    let maxActiveCalls = 0
    let statusCallCount = 0
    let releaseStatus: (() => void) | undefined
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve
    })

    const manager = createManagerWithStatus(async () => {
      statusCallCount += 1
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await statusGate
      activeCalls -= 1
      return { data: {} }
    })

    //#when
    const firstPoll = manager["pollRunningTasks"]()
    await Promise.resolve()
    const secondPoll = manager["pollRunningTasks"]()
    releaseStatus?.()
    await Promise.all([firstPoll, secondPoll])
    manager.shutdown()

    //#then
    expect(maxActiveCalls).toBe(1)
    expect(statusCallCount).toBe(1)
  })
})


function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function injectTask(manager: BackgroundManager, task: BackgroundTask): void {
  manager["tasks"].set(task.id, task)
}

function createManagerWithClient(clientOverrides: Record<string, unknown> = {}): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: {} }),
      get: async () => ({ data: { id: "ses-default" } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({
        data: [{
          info: { role: "assistant", finish: "end_turn", id: "msg-2" },
          parts: [{ type: "text", text: "done" }],
        }, {
          info: { role: "user", id: "msg-1" },
          parts: [{ type: "text", text: "go" }],
        }],
      }),
      ...clientOverrides,
    },
  }
  return new BackgroundManager(
    { pluginContext: createPluginContext(client), config: undefined, enableParentSessionNotifications: false },
  )
}

describe("BackgroundManager verifySessionExists", () => {
  describe("#given session.get reports a not-found response", () => {
    test("#when verifySessionExists runs #then it returns false", async () => {
      //#given
      const manager = createManagerWithClient({
        get: async () => ({
          error: { message: "Session not found", status: 404 },
          data: undefined,
        }),
      })

      //#when
      const result = await manager["verifySessionExists"]("ses-missing")
      await manager.shutdown()

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given session.get reports a transient transport error", () => {
    test("#when verifySessionExists runs #then it returns true", async () => {
      //#given
      const manager = createManagerWithClient({
        get: async () => ({
          error: { message: "Network timeout", status: 500 },
          data: undefined,
        }),
      })

      //#when
      const result = await manager["verifySessionExists"]("ses-transient")
      await manager.shutdown()

      //#then
      expect(result).toBe(true)
    })
  })
})

describe("BackgroundManager pollRunningTasks", () => {
  describe("#given a running task whose session is no longer in status response", () => {
    test("#when pollRunningTasks runs #then completes the task instead of leaving it running", async () => {
      //#given
      const manager = createManagerWithClient()
      const task = createRunningTask("ses-gone")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })

    test("#when the first missing-status poll has no output #then it does not fail the task yet", async () => {
      //#given
      const getSession = mock(async () => ({
        error: { message: "Session not found", status: 404 },
        data: undefined,
      }))
      const manager = createManagerWithClient({
        get: getSession,
        messages: async () => ({ data: [] }),
      })
      const task = createRunningTask("ses-first-miss")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      await manager.shutdown()

      //#then
      expect(task.status).toBe("running")
      expect(task.error).toBeUndefined()
      expect(task.consecutiveMissedPolls).toBe(1)
      expect(getSession).not.toHaveBeenCalled()
    })

    test("#when status polling is unavailable #then it does not complete or increment missed polls", async () => {
      const cases: Array<{ name: string; status?: (() => Promise<{ data: Record<string, { type: string }> }>) | undefined }> = [
        { name: "missing status method", status: undefined },
        { name: "throwing status method", status: async () => { throw new Error("status unavailable") } },
      ]

      for (const testCase of cases) {
        //#given
        let abortCallCount = 0
        const manager = createManagerWithClient({
          status: testCase.status,
          abort: async () => {
            abortCallCount += 1
            return {}
          },
        })
        const task = createRunningTask(`ses-${testCase.name.replace(/ /g, "-")}`)
        injectTask(manager, task)

        //#when
        const poll = manager["pollRunningTasks"]
        for (let count = 0; count < MIN_SESSION_GONE_POLLS + 1; count += 1) {
          await poll.call(manager)
        }

        //#then
        expect(task.status).toBe("running")
        expect(task.completedAt).toBeUndefined()
        expect(task.error).toBeUndefined()
        expect(task.consecutiveMissedPolls ?? 0).toBe(0)
        expect(abortCallCount).toBe(0)

        await manager.shutdown()
      }
    })

    test("#when reliable status polling omits the session #then it completes through the session-gone path", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: {} }),
      })
      const task = createRunningTask("ses-reliably-gone")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      for (let count = 0; count < MIN_SESSION_GONE_POLLS; count += 1) {
        await poll.call(manager)
      }
      await manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })
  })

  describe("#given a running task whose session status is idle", () => {
    test("#when pollRunningTasks runs #then completes the task", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle": { type: "idle" } } }),
      })
      const task = createRunningTask("ses-idle")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
    })

    test("#when output was already observed from events #then it completes without fetching messages", async () => {
      //#given
      let messagesCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-cached": { type: "idle" } } }),
        messages: async () => {
          messagesCallCount += 1
          return {
            data: [{
              info: { role: "assistant", finish: "end_turn", id: "msg-2" },
              parts: [{ type: "text", text: "done" }],
            }],
          }
        },
      })
      const task = createRunningTask("ses-idle-cached")
      injectTask(manager, task)

      manager.handleEvent({
        type: "message.part.updated",
        properties: { sessionID: "ses-idle-cached", type: "text" },
      })

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(messagesCallCount).toBe(0)
    })

    test("#when todo state was already observed from events #then it completes without fetching todos", async () => {
      //#given
      let todoCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-todo-cached": { type: "idle" } } }),
        todo: async () => {
          todoCallCount += 1
          return { data: [] }
        },
      })
      const task = createRunningTask("ses-idle-todo-cached")
      injectTask(manager, task)

      manager.handleEvent({
        type: "message.part.updated",
        properties: { sessionID: "ses-idle-todo-cached", type: "text" },
      })
      manager.handleEvent({
        type: "todo.updated",
        properties: {
          sessionID: "ses-idle-todo-cached",
          todos: [
            { id: "todo-1", content: "done", status: "completed", priority: "high" },
          ],
        },
      })

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(todoCallCount).toBe(0)
    })

    test("#when cached incomplete todos become complete before idle polling #then refreshes todos and completes", async () => {
      //#given
      let todoCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-stale-todos": { type: "idle" } } }),
        todo: async () => {
          todoCallCount += 1
          return {
            data: [
              { content: "compile result", status: "completed", priority: "high" },
            ],
          }
        },
      })
      const task = createRunningTask("ses-idle-stale-todos")
      injectTask(manager, task)

      manager.handleEvent({
        type: "message.part.updated",
        properties: { sessionID: "ses-idle-stale-todos", type: "text" },
      })
      manager.handleEvent({
        type: "todo.updated",
        properties: {
          sessionID: "ses-idle-stale-todos",
          todos: [
            { content: "compile result", status: "in_progress", priority: "high" },
          ],
        },
      })

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(todoCallCount).toBe(1)
    })
  })

  describe("#given a running task whose session status is busy", () => {
    test("#when pollRunningTasks runs #then keeps the task running", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-busy": { type: "busy" } } }),
      })
      const task = createRunningTask("ses-busy")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("running")
    })

    test("#when progress is older than prune TTL #then active status still keeps the task running", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-busy-stale": { type: "busy" } } }),
      })
      const task = createRunningTask("ses-busy-stale")
      task.startedAt = new Date(Date.now() - 60 * 60 * 1000)
      task.progress = {
        toolCalls: 4,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      }
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("running")
      expect(task.error).toBeUndefined()
    })
  })

  describe("#given a running task whose session has terminal non-idle status", () => {
    test('#when session status is "interrupted" #then completes the task', async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-interrupted": { type: "interrupted" } } }),
      })
      const task = createRunningTask("ses-interrupted")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })

    test('#when session status is an unknown type #then completes the task', async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-unknown": { type: "some-weird-status" } } }),
      })
      const task = createRunningTask("ses-unknown")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })

    test('#when session status is "interrupted" with assistant output #then still completes the task', async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-interrupted-with-output": { type: "interrupted" } } }),
        messages: async () => ({
          data: [{
            info: { role: "assistant", finish: "end_turn", id: "msg-2" },
            parts: [{ type: "text", text: "partial progress before interruption" }],
          }],
        }),
      })
      const task = createRunningTask("ses-interrupted-with-output")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)
      manager.shutdown()

      //#then
      expect(task.status).toBe("completed")
      expect(task.completedAt).toBeDefined()
    })
  })

  describe("#given a session whose messages fetch fails while completion is being decided", () => {
    test('#when session status is "interrupted" and messages fetch throws #then the task keeps waiting instead of false-completing', async () => {
      //#given
      let abortCallCount = 0
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-interrupted-fetch-error": { type: "interrupted" } } }),
        messages: async () => {
          throw new Error("messages endpoint unavailable")
        },
        abort: async () => {
          abortCallCount += 1
          return {}
        },
      })
      const task = createRunningTask("ses-interrupted-fetch-error")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)

      //#then
      expect(task.status).toBe("running")
      expect(task.error).toBeUndefined()
      expect(task.completedAt).toBeUndefined()
      expect(abortCallCount).toBe(0)
      await manager.shutdown()
    })

    test("#when session status is idle and messages fetch throws #then the task keeps waiting instead of false-completing", async () => {
      //#given
      const manager = createManagerWithClient({
        status: async () => ({ data: { "ses-idle-fetch-error": { type: "idle" } } }),
        messages: async () => {
          throw new Error("messages endpoint unavailable")
        },
      })
      const task = createRunningTask("ses-idle-fetch-error")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)

      //#then
      expect(task.status).toBe("running")
      expect(task.completedAt).toBeUndefined()
      await manager.shutdown()
    })

    test("#when session.idle fires and messages fetch throws #then the task keeps waiting instead of false-completing", async () => {
      //#given
      let messagesCallCount = 0
      const manager = createManagerWithClient({
        messages: async () => {
          messagesCallCount += 1
          throw new Error("messages endpoint unavailable")
        },
      })
      const task = createRunningTask("ses-idle-event-fetch-error")
      task.startedAt = new Date(Date.now() - (MIN_IDLE_TIME_MS + 1000))
      injectTask(manager, task)

      //#when
      manager.handleEvent({
        type: "session.idle",
        properties: { sessionID: "ses-idle-event-fetch-error" },
      })
      const settleDeadline = Date.now() + 2000
      while (messagesCallCount === 0 && Date.now() < settleDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await new Promise((resolve) => setTimeout(resolve, 50))

      //#then
      expect(messagesCallCount).toBeGreaterThan(0)
      expect(task.status).toBe("running")
      expect(task.completedAt).toBeUndefined()
      await manager.shutdown()
    })
  })

  describe("#given a concurrent completion racing the startup-failure teardown", () => {
    test("#when the task completes during failure teardown awaits #then failCrashedTask does not overwrite the completed state", async () => {
      //#given
      const client = {
        session: {
          status: async () => ({ data: { "ses-race-complete": { type: "interrupted" } } }),
          get: async () => ({ data: { id: "ses-default" } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          todo: async () => ({ data: [] }),
          messages: async () => ({
            data: [{
              info: { role: "user", id: "msg-1" },
              parts: [{ type: "text", text: "only the initiating user prompt" }],
            }],
          }),
        },
      }

      const manager = new BackgroundManager({
        pluginContext: createPluginContext(client),
        config: undefined,
        enableParentSessionNotifications: false,
        onSubagentSessionDeleted: async (event) => {
          // Simulates a concurrent completion landing inside the teardown await window.
          const racing = manager["tasks"].get("bg_test_ses-race-complete")
          if (racing && racing.sessionId === event.sessionID) {
            racing.status = "completed"
            racing.completedAt = new Date()
          }
        },
      })

      const task = createRunningTask("ses-race-complete")
      injectTask(manager, task)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)

      //#then
      expect(task.status).toBe("completed")
      expect(task.error).toBeUndefined()
      await manager.shutdown()
    })
  })

  describe("#given an interrupted user-only child alongside a busy sibling", () => {
    test("#when pollRunningTasks runs #then the outputless child errors explicitly while the busy sibling keeps running", async () => {
      //#given
      const abortedSessionIDs: string[] = []
      const paneCleanupSessionIDs: string[] = []
      const releasedKeys: string[] = []

      const client = {
        session: {
          status: async () => ({
            data: {
              "ses-interrupted-user-only": { type: "interrupted" },
              "ses-busy-sibling": { type: "busy" },
            },
          }),
          get: async () => ({ data: { id: "ses-default" } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async (options: { path?: { id?: string } }) => {
            abortedSessionIDs.push(options?.path?.id ?? "unknown")
            return {}
          },
          todo: async () => ({ data: [] }),
          messages: async (options: { path?: { id?: string } }) => {
            if (options?.path?.id === "ses-interrupted-user-only") {
              return {
                data: [{
                  info: { role: "user", id: "msg-1" },
                  parts: [{ type: "text", text: "only the initiating user prompt" }],
                }],
              }
            }
            return { data: [] }
          },
        },
      }

      const manager = new BackgroundManager({
        pluginContext: createPluginContext(client),
        config: undefined,
        enableParentSessionNotifications: false,
        onSubagentSessionDeleted: async (event) => {
          paneCleanupSessionIDs.push(event.sessionID)
        },
      })

      const originalRelease = manager["concurrencyManager"].release.bind(manager["concurrencyManager"])
      manager["concurrencyManager"].release = (key: string) => {
        releasedKeys.push(key)
        originalRelease(key)
      }

      const interruptedChild = createRunningTask("ses-interrupted-user-only")
      interruptedChild.concurrencyKey = "test-provider/test-model"
      const busySibling = createRunningTask("ses-busy-sibling")
      busySibling.concurrencyKey = "test-provider/test-model"
      injectTask(manager, interruptedChild)
      injectTask(manager, busySibling)

      //#when
      const poll = manager["pollRunningTasks"]
      await poll.call(manager)

      //#then
      expect(interruptedChild.status).toBe("error")
      expect(interruptedChild.error).toContain("without producing any assistant or tool output")
      expect(interruptedChild.completedAt).toBeDefined()
      expect(busySibling.status).toBe("running")
      expect(abortedSessionIDs).toEqual(["ses-interrupted-user-only"])
      expect(paneCleanupSessionIDs).toEqual(["ses-interrupted-user-only"])
      expect(releasedKeys).toEqual(["test-provider/test-model"])

      // shutdown() intentionally aborts surviving running sessions (#1240), so
      // teardown-sensitive assertions above run before it.
      await manager.shutdown()
    })
  })
})
