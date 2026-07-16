/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { BackgroundManager, type BackgroundTask } from "../../features/background-agent"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createWaitForBackgroundTasks } from "./create-wait-for-background-tasks"

const PARENT_SESSION_ID = "main-1"
const toolContext: ToolContext = {
  sessionID: PARENT_SESSION_ID,
  messageID: "msg-1",
  agent: "sisyphus",
  directory: tmpdir(),
  worktree: tmpdir(),
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionId: "ses-1",
    parentSessionId: PARENT_SESSION_ID,
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "explore",
    status: "running",
    ...overrides,
  }
}

function hasActiveTasks(tasks: BackgroundTask[]): boolean {
  return tasks.some((task) => task.status === "pending" || task.status === "running")
}

function createManager(
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
  timeout: number,
): Promise<string> {
  const tool = createWaitForBackgroundTasks(manager, {
    pollIntervalMs: 1,
    minimumTimeoutMs: 10,
  })
  return String(await tool.execute?.({ timeout }, toolContext))
}

describe("wait-for-background-tasks lifecycle settling", () => {
  test("keeps waiting while terminal-task finalization is still in flight", async () => {
    // #given a task that becomes terminal while teardown remains pending
    let task = createTask({ status: "running" })
    let finalizationPending = true
    const manager = createManager(
      () => [task],
      () => task.status === "running" || finalizationPending,
    )

    // #when completion status flips before finalization clears
    const run = runTool(manager, 100)
    task = createTask({ status: "completed" })
    const beforeRelease = await Promise.race([
      run.then(() => "RETURNED"),
      new Promise<string>((resolve) => setTimeout(() => resolve("WAITING"), 20)),
    ])

    // #then the waiter remains blocked until finalization settles
    expect(beforeRelease).toBe("WAITING")
    finalizationPending = false
    expect(await run).toContain("**COMPLETED**")
  })

  test("returns after real manager finalization queues a deferred active-turn wake", async () => {
    // #given a real manager whose parent session stays active
    const tempProjectDir = mkdtempSync(join(tmpdir(), "omo-waiter-wake-"))
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" })
    Object.assign(client.session, {
      messages: async () => [],
      status: async () => ({ data: { [PARENT_SESSION_ID]: { type: "busy" } } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    })
    const manager = new BackgroundManager({
      pluginContext: unsafeTestValue<PluginInput>({
        client,
        project: {},
        directory: tempProjectDir,
        worktree: tempProjectDir,
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost"),
        $: {},
      }),
      enableParentSessionNotifications: true,
    })
    const task = createTask({ sessionId: undefined })
    const tasks = Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
    const pendingByParent = Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
    tasks.set(task.id, task)
    pendingByParent.set(task.parentSessionId, new Set([task.id]))

    try {
      // #when the child completes during the active wait call
      const run = runTool(manager, 200)
      const complete = Reflect.get(manager, "tryCompleteTask") as (
        task: BackgroundTask,
        source: string,
      ) => Promise<boolean>
      const completion = complete.call(manager, task, "waiter integration test")
      const output = await run
      await completion

      // #then finalization is observed without self-blocking on the deferred wake
      expect(output).toContain("**COMPLETED**")
      expect(output).not.toContain("timed out")
      expect(manager.hasPendingParentWake(task.parentSessionId)).toBe(true)
      expect(manager.hasBackgroundWorkInFlight(task.parentSessionId)).toBe(false)
    } finally {
      await manager.shutdown()
      rmSync(tempProjectDir, { recursive: true, force: true })
    }
  })

  test("keeps waiting while a same-session launch is pending task registration", async () => {
    // #given a launch reservation visible before task indexing
    let tasks: BackgroundTask[] = []
    let launchPending = true
    const manager = createManager(
      () => tasks,
      () => launchPending || hasActiveTasks(tasks),
    )

    // #when the waiter starts during the registration gap
    const run = runTool(manager, 100)
    const beforeRegistration = await Promise.race([
      run.then(() => "RETURNED"),
      new Promise<string>((resolve) => setTimeout(() => resolve("WAITING"), 20)),
    ])

    // #then it observes the task after registration completes
    expect(beforeRegistration).toBe("WAITING")
    tasks = [createTask({ id: "task-delayed-registration" })]
    launchPending = false
    const output = await run
    expect(output).toContain("`task-delayed-registration`")
    expect(output).toContain("Still Running")
  })

  test("reports timeout while task registration or finalization remains in flight", async () => {
    // #given work remains in flight without a non-terminal task row
    const tasks = [createTask({ status: "completed" })]
    const manager = createManager(() => tasks, () => true)

    // #when the bounded wait expires
    const output = await runTool(manager, 10)

    // #then terminal state and finalization timeout are both visible
    expect(output).toContain("## Terminal Tasks")
    expect(output).toContain("## Wait Timed Out")
  })
})
