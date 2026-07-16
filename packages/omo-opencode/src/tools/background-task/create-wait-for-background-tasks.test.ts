/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
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

function createManager(sequences: BackgroundTask[][]): BackgroundManager {
  let call = 0
  return unsafeTestValue<BackgroundManager>({
    getTasksByParentSession: (_sessionID: string) => {
      const index = Math.min(call, sequences.length - 1)
      call += 1
      return sequences[index]
    },
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
  test("returns early when the session has no active tasks", async () => {
    // #given a manager with only terminal tasks
    const manager = createManager([[createTask({ status: "completed" })]])

    // #when the tool runs
    const output = await runTool(manager, {})

    // #then it reports nothing to wait for
    expect(output).toBe("No running or pending background tasks found for this session.")
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
    expect(output).toContain("## Completed Tasks")
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
    expect(output).toContain("## Completed Tasks")
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
    })

    // #when the tool reaches its timeout with the new task still active
    const output = await runTool(manager, { timeout: 100 }, { pollIntervalMs: 1 })

    // #then it reports the newly observed active task instead of a completion-only result
    expect(output).toContain("## Still Running (timed out")
    expect(output).toContain("`task-2`")
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
