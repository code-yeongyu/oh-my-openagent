/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { BackgroundManager, type BackgroundTask } from "../../features/background-agent"
import type { OpencodeClient } from "../delegate-task/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createWaitForBackgroundTasks } from "./create-wait-for-background-tasks"
import { createBackgroundTools } from "../index"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"

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
    getTasksByParentSession: (_sessionID: string) => {
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
    getTasksByParentSession: getTasks,
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
      getTasksByParentSession: () => {
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
      getTasksByParentSession: () => {
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

  test("keeps waiting while terminal-task finalization is still in flight", async () => {
    // #given a task that becomes terminal while the manager still owes teardown/notification work
    let task = createTask({ status: "running" })
    let finalizationPending = true
    const manager = createManagerWithWorkState(
      () => [task],
      () => task.status === "running" || finalizationPending,
    )

    // #when completion status flips but finalization remains blocked
    const run = runTool(manager, { timeout: 100 }, { pollIntervalMs: 1 })
    task = createTask({ status: "completed" })
    const beforeRelease = await Promise.race([
      run.then(() => "RETURNED"),
      new Promise<string>((resolve) => setTimeout(() => resolve("WAITING"), 20)),
    ])

    // #then the waiter does not return until the authoritative finalization state clears
    expect(beforeRelease).toBe("WAITING")
    finalizationPending = false
    expect(await run).toContain("**COMPLETED**")
  })

  test("returns after real manager finalization queues a deferred active-turn wake", async () => {
    // #given a real manager whose parent session stays active while the waiter runs
    const tempProjectDir = mkdtempSync(join(tmpdir(), "omo-waiter-wake-"))
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
    Object.assign(client.session, {
      messages: async () => [],
      status: async () => ({ data: { "main-1": { type: "busy" } } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    })
    const pluginContext = unsafeTestValue<PluginInput>({
      client,
      project: {},
      directory: tempProjectDir,
      worktree: tempProjectDir,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost"),
      $: {},
    })
    const manager = new BackgroundManager({
      pluginContext,
      enableParentSessionNotifications: true,
    })
    const task = createTask({ sessionId: undefined })
    const tasks = Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
    const pendingByParent = Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
    tasks.set(task.id, task)
    pendingByParent.set(task.parentSessionId, new Set([task.id]))

    try {
      // #when the child completes during the active wait tool call
      const run = runTool(manager, { timeout: 200 }, { pollIntervalMs: 1 })
      const tryCompleteTask = Reflect.get(manager, "tryCompleteTask") as (
        task: BackgroundTask,
        source: string,
      ) => Promise<boolean>
      const completion = tryCompleteTask.call(manager, task, "waiter integration test")
      const output = await run
      await completion

      // #then finalization is observed, but deferred wake delivery does not self-block the waiter
      expect(output).toContain("**COMPLETED**")
      expect(output).not.toContain("timed out")
      expect(manager.hasPendingParentWake(task.parentSessionId)).toBe(true)
      expect(manager.hasBackgroundWorkInFlight(task.parentSessionId)).toBe(false)
    } finally {
      manager.shutdown()
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
  })

  test("keeps waiting while a same-session launch is pending task registration", async () => {
    // #given a launch reservation is visible before its task has been indexed
    let tasks: BackgroundTask[] = []
    let launchPending = true
    const manager = createManagerWithWorkState(
      () => tasks,
      () => launchPending || activeTasksForTest(tasks).length > 0,
    )

    // #when the waiter starts during the pre-registration gap
    const run = runTool(manager, { timeout: 100 }, { pollIntervalMs: 1 })
    const beforeRegistration = await Promise.race([
      run.then(() => "RETURNED"),
      new Promise<string>((resolve) => setTimeout(() => resolve("WAITING"), 20)),
    ])

    // #then it remains blocked and observes the task once registration completes
    expect(beforeRegistration).toBe("WAITING")
    tasks = [createTask({ id: "task-delayed-registration", status: "running" })]
    launchPending = false
    const output = await run
    expect(output).toContain("`task-delayed-registration`")
    expect(output).toContain("Still Running")
  })

  test("surfaces still-running tasks when the wait times out", async () => {
    // #given a task that never leaves the running state
    const manager = createManager([[createTask({ status: "running" })]])

    // #when the tool runs with a tiny timeout
    const output = await runTool(manager, { timeout: 1 })

    // #then it reports the task as still running after timing out
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-1`")
  })

  test("reports timeout while task registration or finalization remains in flight", async () => {
    // #given manager work remains in flight without a non-terminal task row
    const manager = createManagerWithWorkState(
      () => [createTask({ status: "completed" })],
      () => true,
    )

    // #when the bounded wait expires
    const output = await runTool(manager, { timeout: 10 }, { pollIntervalMs: 1 })

    // #then the terminal task remains visible and the timeout is not disguised as success
    expect(output).toContain("## Terminal Tasks")
    expect(output).toContain("## Wait Timed Out")
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
      getTasksByParentSession: () => {
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
      getTasksByParentSession: () => {
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
