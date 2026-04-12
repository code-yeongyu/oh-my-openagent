import { describe, test, expect } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundTask } from "./types"
import { BackgroundManager } from "./manager"

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

  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "parent-1",
    parentMessageID: "msg-1",
    description: "background polling task",
    prompt: "do work",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

function stubNotifyParentSession(manager: BackgroundManager): void {
  ;(manager as unknown as { notifyParentSession: () => Promise<void> }).notifyParentSession = async () => {}
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
    const firstPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    await Promise.resolve()
    const secondPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    releaseStatus?.()
    await Promise.all([firstPoll, secondPoll])
    manager.shutdown()

    //#then
    expect(maxActiveCalls).toBe(1)
    expect(statusCallCount).toBe(1)
  })
})

describe("BackgroundManager pollRunningTasks completion guards", () => {
  test("does not complete an idle task when the latest assistant finish is tool-calls", async () => {
    //#given
    const abortedSessionIDs: string[] = []
    const manager = new BackgroundManager({
      client: {
        session: {
          status: async () => ({ data: { "ses-tool-calls": { type: "idle" } } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async (args: { path: { id: string } }) => {
            abortedSessionIDs.push(args.path.id)
            return {}
          },
          todo: async () => ({ data: [] }),
          messages: async () => ({
            data: [
              {
                info: {
                  role: "assistant",
                  finish: "tool-calls",
                  time: { created: 1000, completed: 2000 },
                },
                parts: [{ type: "tool_result", content: "tool-only progress" }],
              },
            ],
          }),
        },
      },
      directory: tmpdir(),
    } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task = createRunningTask({
      id: "task-tool-calls",
      sessionID: "ses-tool-calls",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()

    //#then
    expect(task.status).toBe("running")
    expect(abortedSessionIDs).toEqual([])

    manager.shutdown()
  })

  test("completes an idle task with terminal assistant finish without aborting the session", async () => {
    //#given
    const abortedSessionIDs: string[] = []
    const manager = new BackgroundManager({
      client: {
        session: {
          status: async () => ({ data: { "ses-terminal": { type: "idle" } } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async (args: { path: { id: string } }) => {
            abortedSessionIDs.push(args.path.id)
            return {}
          },
          todo: async () => ({ data: [] }),
          messages: async () => ({
            data: [
              {
                info: {
                  role: "assistant",
                  finish: "stop",
                  time: { created: 1000, completed: 2000 },
                },
                parts: [{ type: "text", text: "final answer" }],
              },
            ],
          }),
        },
      },
      directory: tmpdir(),
    } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task = createRunningTask({
      id: "task-terminal",
      sessionID: "ses-terminal",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()

    //#then
    expect(task.status).toBe("completed")
    expect(abortedSessionIDs).toEqual([])

    manager.shutdown()
  })

  test("completes an idle task when a completed tool-call turn is followed by an empty assistant tail", async () => {
    //#given
    const manager = new BackgroundManager({
      client: {
        session: {
          status: async () => ({ data: { "ses-empty-tail": { type: "idle" } } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          todo: async () => ({ data: [] }),
          messages: async () => ({
            data: [
              {
                info: {
                  role: "assistant",
                  finish: "tool-calls",
                  time: { created: 1000, completed: 2000 },
                },
                parts: [{ type: "reasoning", text: "tool finished successfully" }],
              },
              {
                info: {
                  role: "assistant",
                  time: { created: 2001 },
                },
                parts: [],
              },
            ],
          }),
        },
      },
      directory: tmpdir(),
    } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task = createRunningTask({
      id: "task-empty-tail",
      sessionID: "ses-empty-tail",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()

    //#then
    expect(task.status).toBe("completed")

    manager.shutdown()
  })

  test("completes an idle task when a completed tool-call turn is followed by step-start and empty text only", async () => {
    //#given
    const manager = new BackgroundManager({
      client: {
        session: {
          status: async () => ({ data: { "ses-meta-tail": { type: "idle" } } }),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          todo: async () => ({ data: [] }),
          messages: async () => ({
            data: [
              {
                info: {
                  role: "assistant",
                  finish: "tool-calls",
                  time: { created: 1000, completed: 2000 },
                },
                parts: [{ type: "reasoning", text: "tool finished successfully" }],
              },
              {
                info: {
                  role: "assistant",
                  time: { created: 2001 },
                },
                parts: [
                  { type: "step-start" },
                  { type: "text", text: "" },
                ],
              },
            ],
          }),
        },
      },
      directory: tmpdir(),
    } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task = createRunningTask({
      id: "task-meta-tail",
      sessionID: "ses-meta-tail",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()

    //#then
    expect(task.status).toBe("completed")

    manager.shutdown()
  })
})
