/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { tmpdir } from "node:os"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { BackgroundManager, type BackgroundTask } from "../../features/background-agent"
import type { OpencodeClient } from "../delegate-task/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createWaitForBackgroundTasks } from "./create-wait-for-background-tasks"
import { createBackgroundTools } from "../index"
import { BACKGROUND_OUTPUT_DESCRIPTION } from "./constants"

const projectDir = tmpdir()

const mockContext: ToolContext = {
  sessionID: "main-1",
  messageID: "msg-1",
  agent: "sisyphus",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "ses-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "explore",
    status: "running",
    ...overrides,
  }
}

function activeTasksForTest(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((task) => task.status === "pending" || task.status === "running")
}

function createManager(sequences: BackgroundTask[][]): BackgroundManager {
  let call = 0
  let lastTasks = sequences[0] ?? []
  return unsafeTestValue<BackgroundManager>({
    getTasksForBackgroundWait: (_sessionID: string) => {
      const index = Math.min(call, sequences.length - 1)
      call += 1
      lastTasks = sequences[index] ?? []
      return lastTasks
    },
    hasBackgroundWorkInFlight: () => activeTasksForTest(lastTasks).length > 0,
  })
}

function createManagerWithWorkState(
  getTasks: () => BackgroundTask[],
  hasBackgroundWorkInFlight: () => boolean,
): BackgroundManager {
  return unsafeTestValue<BackgroundManager>({
    getTasksForBackgroundWait: getTasks,
    hasBackgroundWorkInFlight,
  })
}

async function runTool(
  manager: BackgroundManager,
  args: { timeout?: number },
  options?: { abort?: AbortSignal; pollIntervalMs?: number; minimumTimeoutMs?: number },
): Promise<string> {
  const tool = createWaitForBackgroundTasks(manager, {
    pollIntervalMs: options?.pollIntervalMs ?? 5,
    minimumTimeoutMs: options?.minimumTimeoutMs ?? 10,
  })
  const result = await tool.execute?.(args, {
    ...mockContext,
    abort: options?.abort ?? mockContext.abort,
  })
  return typeof result === "string" ? result : String(result)
}

describe("createWaitForBackgroundTasks", () => {
  test("reports retained terminal tasks when work finished before the waiter started", async () => {
    // #given a manager with only terminal tasks
    const manager = createManager([[createTask({ status: "completed" })]])

    // #when the tool runs
    const output = await runTool(manager, {})

    // #then the fast completion remains visible instead of looking like no work existed
    expect(output).toContain("## Terminal Tasks")
    expect(output).toContain("`task-1`")
    expect(output).toContain("**COMPLETED**")
  })

  test("waits for a task registered in a microtask after the initial empty snapshot", async () => {
    // #given the first read is empty while a same-session task is queued in a microtask
    let tasks: BackgroundTask[] = []
    let reads = 0
    const manager = unsafeTestValue<BackgroundManager>({
      getTasksForBackgroundWait: () => {
        reads += 1
        if (reads === 1) {
          queueMicrotask(() => {
            tasks = [createTask({ id: "task-microtask" })]
          })
        }
        return tasks
      },
      hasBackgroundWorkInFlight: () => activeTasksForTest(tasks).length > 0,
    })

    // #when the wait reaches its bounded timeout
    const output = await runTool(manager, { timeout: 30 }, { pollIntervalMs: 1 })

    // #then the asynchronously registered task is reported instead of being omitted
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-microtask`")
  })

  test("waits for a task registered by a timer after the initial empty snapshot", async () => {
    // #given the first read is empty while a same-session task is queued by a timer
    let tasks: BackgroundTask[] = []
    let reads = 0
    const manager = unsafeTestValue<BackgroundManager>({
      getTasksForBackgroundWait: () => {
        reads += 1
        if (reads === 1) {
          setTimeout(() => {
            tasks = [createTask({ id: "task-timer" })]
          }, 0)
        }
        return tasks
      },
      hasBackgroundWorkInFlight: () => activeTasksForTest(tasks).length > 0,
    })

    // #when the wait reaches its bounded timeout
    const output = await runTool(manager, { timeout: 30 }, { pollIntervalMs: 5 })

    // #then the timer-registered task is reported instead of being omitted
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-timer`")
  })

  test("blocks until the active task reaches a terminal state, then reports completion", async () => {
    // #given a task that is running on the first poll and completed afterwards
    const manager = createManager([
      [createTask({ status: "running" })],
      [createTask({ status: "completed" })],
    ])

    // #when the tool runs
    const output = await runTool(manager, {})

    // #then it returns the completed-task summary
    expect(output).toContain("## Terminal Tasks")
    expect(output).toContain("`task-1`")
    expect(output).toContain("**COMPLETED**")
  })

  test("surfaces still-running tasks when the wait times out", async () => {
    // #given a task that never leaves the running state
    const manager = createManager([[createTask({ status: "running" })]])

    // #when the tool runs with a tiny timeout
    const output = await runTool(manager, { timeout: 1 })

    // #then it reports the task as still running after timing out
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-1`")
    expect(output).toContain("Do NOT end your turn")
    expect(output).toContain("call `wait-for-background-tasks` again")
  })

  test("prioritizes active tasks when retained terminal history exceeds the result cap", async () => {
    // #given 100 retained terminal tasks precede one active descendant
    const terminalTasks = Array.from({ length: 100 }, (_, index) => createTask({
      id: `terminal-${index}`,
      status: "completed",
    }))
    const activeTask = createTask({ id: "active-after-history", status: "running" })
    const manager = createManager([[...terminalTasks, activeTask]])

    // #when
    const output = await runTool(manager, { timeout: 1 })

    // #then
    expect(output).toContain("`active-after-history`")
    expect(output).toContain("## Still Running")
  })

  test("keeps the root wait open for an active grandchild after its direct child completes", async () => {
    // #given a completed direct child whose nested descendant is still running
    const directChild = createTask({
      id: "task-direct",
      sessionId: "ses-direct",
      description: "completed direct child",
      status: "completed",
    })
    const grandchild = createTask({
      id: "task-grandchild",
      sessionId: "ses-grandchild",
      parentSessionId: "ses-direct",
      description: "running grandchild",
      status: "running",
    })
    const descendants = [directChild, grandchild]
    const manager = createManagerWithWorkState(
      () => descendants,
      () => activeTasksForTest(descendants).length > 0,
    )

    // #when the bounded root wait expires while the grandchild remains active
    const output = await runTool(manager, { timeout: 10 }, { pollIntervalMs: 1 })

    // #then the grandchild keeps the waiter open and is named in the timeout result
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-grandchild`")
    expect(output).toContain("running grandchild")
  })

  test.each([0, -1])("does not let timeout %i bypass an active task", async (timeout) => {
    // #given an active task that completes after the first poll
    const manager = createManager([
      [createTask({ status: "running" })],
      [createTask({ status: "running" })],
      [createTask({ status: "completed" })],
    ])

    // #when the tool receives a non-positive timeout
    const output = await runTool(manager, { timeout }, { pollIntervalMs: 1, minimumTimeoutMs: 100 })

    // #then it polls instead of returning an immediate timeout
    expect(output).toContain("## Terminal Tasks")
    expect(output).not.toContain("Still Running")
  })

  test("keeps waiting when a task appears asynchronously during completion settling", async () => {
    // #given the original task completes while a new same-session task is queued asynchronously
    const newTask = createTask({ id: "task-2", description: "new background task", status: "running" })
    let tasks = [createTask({ status: "running" })]
    let reads = 0
    const manager = unsafeTestValue<BackgroundManager>({
      getTasksForBackgroundWait: () => {
        reads += 1
        if (reads === 2) {
          tasks = [createTask({ status: "completed" })]
          queueMicrotask(() => {
            tasks = [createTask({ status: "completed" }), newTask]
          })
        }
        return tasks
      },
      hasBackgroundWorkInFlight: () => activeTasksForTest(tasks).length > 0,
    })

    // #when the tool reaches its timeout with the new task still active
    const output = await runTool(manager, { timeout: 100 }, { pollIntervalMs: 1 })

    // #then it reports the newly observed active task instead of a completion-only result
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-2`")
  })

  test("rechecks after a task is queued in a microtask following the confirmation snapshot", async () => {
    // #given the original task completes and the confirmation read queues a new task
    const newTask = createTask({ id: "task-after-confirmation", status: "running" })
    let tasks = [createTask({ status: "running" })]
    let reads = 0
    const manager = unsafeTestValue<BackgroundManager>({
      getTasksForBackgroundWait: () => {
        reads += 1
        if (reads === 2) {
          tasks = [createTask({ status: "completed" })]
        }
        if (reads === 3) {
          queueMicrotask(() => {
            tasks = [createTask({ status: "completed" }), newTask]
          })
        }
        return tasks
      },
      hasBackgroundWorkInFlight: () => activeTasksForTest(tasks).length > 0,
    })

    // #when the wait reaches its bounded timeout
    const output = await runTool(manager, { timeout: 30 }, { pollIntervalMs: 1 })

    // #then the task queued after the confirmation snapshot is still observed
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-after-confirmation`")
  })

  test("stops promptly when the tool call is aborted", async () => {
    // #given a task that remains active and a long poll interval
    const manager = createManager([[createTask({ status: "running" })]])
    const controller = new AbortController()
    const run = runTool(manager, {}, { abort: controller.signal, pollIntervalMs: 10_000 })

    // #when the parent tool call is aborted
    controller.abort()

    // #then the wait resolves without staying blocked on the polling interval
    const output = await Promise.race([
      run,
      new Promise<string>((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ])
    expect(output).not.toBe("TEST_TIMEOUT")
    expect(output).toContain("cancelled")
    expect(output).toContain("`task-1`")
    expect(output).toContain("running")
  })

  test("bounds retained task descriptions and errors independently of global truncation", async () => {
    // #given a retained terminal task with provider-controlled oversized fields
    const oversizedTask = createTask({
      status: "completed",
      description: "D".repeat(200_000),
      error: "E".repeat(200_000),
    })
    const manager = createManager([
      [createTask({ status: "running" })],
      [oversizedTask],
    ])

    // #when the waiter formats the terminal snapshot
    const output = await runTool(manager, {})

    // #then the result has a hard local bound and marks truncation
    expect(output.length).toBeLessThanOrEqual(24_000)
    expect(output).toContain("truncated")
  })

  test("bounds unexpected manager errors", async () => {
    // #given a manager failure with an oversized provider-controlled message
    const manager = unsafeTestValue<BackgroundManager>({
      getTasksForBackgroundWait: () => { throw new Error("E".repeat(100_000)) },
    })

    // #when the waiter catches the failure
    const output = await runTool(manager, {})

    // #then the error return obeys the same aggregate output bound
    expect(output.length).toBeLessThanOrEqual(24_000)
    expect(output).toContain("truncated")
  })
})

describe("background output guidance", () => {
  test("permits retrieval after the waiter reports a terminal task", () => {
    expect(BACKGROUND_OUTPUT_DESCRIPTION).toContain("wait-for-background-tasks")
    expect(BACKGROUND_OUTPUT_DESCRIPTION).toContain("terminal")
  })
})

describe("createBackgroundTools gating", () => {
  const manager = unsafeTestValue<BackgroundManager>({})
  const client = unsafeTestValue<OpencodeClient>({})

  test("omits wait-for-background-tasks by default", () => {
    // #given no options
    // #when tools are created
    const tools = createBackgroundTools(manager, client)

    // #then the blocking tool is not registered
    expect(tools["wait-for-background-tasks"]).toBeUndefined()
    expect(tools.background_output).toBeDefined()
    expect(tools.background_cancel).toBeDefined()
  })

  test("registers wait-for-background-tasks when blockOnBackgroundTasks is enabled", () => {
    // #given the flag enabled
    // #when tools are created
    const tools = createBackgroundTools(manager, client, { blockOnBackgroundTasks: true })

    // #then the blocking tool is registered
    expect(tools["wait-for-background-tasks"]).toBeDefined()
  })
})
