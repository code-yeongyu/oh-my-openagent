import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import { acquireLock } from "../../features/claude-tasks/storage"
import { createTaskCreateTool } from "./task-create"
import { createTaskUpdateTool } from "./task-update"
import type { TaskObject } from "./types"

const TEST_SESSION_ID = "test-session-concurrency"
const TEST_ABORT_CONTROLLER = new AbortController()
const TEST_CONTEXT = {
  sessionID: TEST_SESSION_ID,
  messageID: "test-message-concurrency",
  agent: "test-agent",
  abort: TEST_ABORT_CONTROLLER.signal,
}
const CONCURRENT_WRITERS = 8

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolveFn) => {
    resolve = resolveFn
  })
  return { promise, resolve }
}

function listTaskIds(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("T-") && name.endsWith(".json"))
    .map((name) => name.replace(".json", ""))
}

describe("task tool lock contention", () => {
  let testDir = ""
  let config: { sisyphus: { tasks: { storage_path: string } } }
  const originalWaitTimeout = process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "omo-task-lock-"))
    config = { sisyphus: { tasks: { storage_path: testDir } } }
  })

  afterEach(() => {
    if (originalWaitTimeout === undefined) {
      delete process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS
    } else {
      process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS = originalWaitTimeout
    }
    rmSync(testDir, { recursive: true, force: true })
  })

  test("persists every task when task_create calls run concurrently", async () => {
    //#given
    const tool = createTaskCreateTool(config)

    //#when
    const results = await Promise.all(
      Array.from({ length: CONCURRENT_WRITERS }, (_, index) =>
        tool.execute({ subject: `Concurrent task ${index}` }, TEST_CONTEXT),
      ),
    )

    //#then
    const parsed = results.map((result) => JSON.parse(result) as { task?: { id: string }; error?: string })
    expect(parsed.filter((result) => result.error !== undefined)).toEqual([])
    expect(new Set(parsed.map((result) => result.task?.id)).size).toBe(CONCURRENT_WRITERS)
    expect(listTaskIds(testDir).length).toBe(CONCURRENT_WRITERS)
  })

  test("persists concurrent task_create and task_update calls against one list", async () => {
    //#given
    const createTool = createTaskCreateTool(config)
    const updateTool = createTaskUpdateTool(config)
    const seededId = "T-seeded-task"
    const seeded: TaskObject = {
      id: seededId,
      subject: "Seeded task",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    await Bun.write(join(testDir, `${seededId}.json`), JSON.stringify(seeded))

    //#when
    const results = await Promise.all([
      ...Array.from({ length: 4 }, (_, index) => createTool.execute({ subject: `Mixed task ${index}` }, TEST_CONTEXT)),
      ...Array.from({ length: 4 }, (_, index) =>
        updateTool.execute({ id: seededId, description: `Update ${index}` }, TEST_CONTEXT),
      ),
    ])

    //#then
    const errors = results.map((result) => JSON.parse(result) as { error?: string }).filter((r) => r.error !== undefined)
    expect(errors).toEqual([])
    expect(listTaskIds(testDir).length).toBe(5)
  })

  test("marks task_lock_unavailable retryable when the wait bound is exhausted", async () => {
    //#given
    process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS = "50"
    const createTool = createTaskCreateTool(config)
    const updateTool = createTaskUpdateTool(config)
    const holder = await acquireLock(testDir, { waitTimeoutMs: 0 })
    expect(holder.acquired).toBe(true)

    //#when
    const createResult = JSON.parse(await createTool.execute({ subject: "Blocked task" }, TEST_CONTEXT))
    const updateResult = JSON.parse(await updateTool.execute({ id: "T-seeded-task", subject: "Blocked" }, TEST_CONTEXT))

    //#then
    expect(createResult).toEqual({ error: "task_lock_unavailable", retryable: true })
    expect(updateResult).toEqual({ error: "task_lock_unavailable", retryable: true })

    //#cleanup
    holder.release()
  })

  test("releases the task lock before syncing todos", async () => {
    //#given
    process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS = "80"
    const enteredSync = deferred()
    const finishSync = deferred()
    const ctx = {
      client: {
        session: {
          todo: async () => {
            enteredSync.resolve()
            await finishSync.promise
            return { data: [] }
          },
        },
      },
    } as unknown as PluginInput
    const syncingTool = createTaskCreateTool(config, ctx)
    const plainTool = createTaskCreateTool(config)

    //#when
    const syncing = syncingTool.execute({ subject: "Task holding todo sync" }, TEST_CONTEXT)
    await enteredSync.promise
    const secondResult = JSON.parse(await plainTool.execute({ subject: "Task during todo sync" }, TEST_CONTEXT))

    //#then
    expect(secondResult.error).toBeUndefined()
    expect(secondResult.task.subject).toBe("Task during todo sync")

    //#cleanup
    finishSync.resolve()
    await syncing
  })
})
