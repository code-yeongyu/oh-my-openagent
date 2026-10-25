import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { readContinuationMarker } from "../run-continuation-state"
import { BackgroundManager } from "./manager"
import type { ConcurrencyManager } from "./concurrency"
import type { BackgroundTask } from "./types"

type Internals = {
  tasks: Map<string, BackgroundTask>
  tasksByParentSession: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  concurrencyManager: ConcurrencyManager
  pendingByParent: Map<string, Set<string>>
  startResumedTask: (...args: unknown[]) => Promise<BackgroundTask>
  updateBackgroundTaskMarker: (parentSessionID: string | undefined) => void
}

const fixtures: Array<{ manager: BackgroundManager; directory: string }> = []

afterEach(async () => {
  mock.restore()
  releaseAllPromptAsyncReservationsForTesting()
  for (const { manager, directory } of fixtures.splice(0)) {
    await manager.shutdown()
    rmSync(directory, { recursive: true, force: true })
  }
})

function createResumeFixture(busy = false) {
  const directory = mkdtempSync(join(tmpdir(), "omo-resume-review-"))
  const promptAsync = mock(async () => ({ data: {} }))
  const log = mock((message: string, data?: unknown) => {
    void message
    void data
  })
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({
      directory,
      client: { session: {
        status: async () => ({ data: busy ? { child: { type: "busy" } } : {} }),
        promptAsync,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      } },
    }),
    config: { defaultConcurrency: 1 },
    enableParentSessionNotifications: false,
    log,
  })
  fixtures.push({ manager, directory })
  const internals = unsafeTestValue<Internals>(manager)
  const task: BackgroundTask = {
    id: "resume-review", sessionId: "child", agent: "explore", status: "completed",
    description: "review task", prompt: "original", parentSessionId: "old-parent",
    parentMessageId: "old-message", completedAt: new Date(),
  }
  internals.tasks.set(task.id, task)
  internals.tasksByParentSession.set(task.parentSessionId, new Set([task.id]))
  manager.taskHistory.record(task.parentSessionId, {
    id: task.id, sessionID: task.sessionId, agent: task.agent,
    description: task.description, status: task.status, completedAt: task.completedAt,
  })
  return { manager, internals, task, directory, promptAsync, log }
}

async function queueResume(parentSessionId = "new-parent", busy = false) {
  const fixture = createResumeFixture(busy)
  await fixture.internals.concurrencyManager.acquire("explore")
  await fixture.manager.resume({ sessionId: "child", prompt: "latest", parentSessionId, parentMessageId: "new-message" })
  return fixture
}

// One event-loop turn drains admission and prompt-gate microtasks without a timed sleep.
const settleAdmission = () => new Promise<void>(resolve => setImmediate(resolve))

describe("queued resume review regressions", () => {
  test("clears the temporary parent's marker after skipped admission", async () => {
    // given
    const { internals, directory, task } = await queueResume("new-parent", true)
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("active")
    // when
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(task.parentSessionId).toBe("old-parent")
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("idle")
  })

  test.each(["old-parent", "new-parent"])("restores history after skipped admission from %s", async parent => {
    // given
    const { manager, internals } = await queueResume(parent, true)
    // when
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(manager.taskHistory.getByParentSession("old-parent").map(entry => entry.status)).toEqual(["completed"])
    expect(manager.taskHistory.getByParentSession("new-parent")).toEqual([])
  })

  test("drops queued continuations on shutdown without reviving timers or parent indexes", async () => {
    // given
    const { manager, internals, task, directory, promptAsync } = await queueResume()
    // when
    await manager.shutdown()
    await settleAdmission()
    // then
    expect(internals.completionTimers.size).toBe(0)
    expect(internals.tasksByParentSession.size).toBe(0)
    expect(task.pendingResume).toBeUndefined()
    expect(manager.taskHistory.getByParentSession("new-parent")).toEqual([])
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("idle")
    expect(promptAsync).not.toHaveBeenCalled()
  })

  test("records running history when a queued continuation is admitted and dispatched", async () => {
    // given
    const { manager, internals, task, promptAsync } = await queueResume()
    // when
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(task.status).toBe("running")
    expect(manager.taskHistory.getByParentSession("new-parent").map(entry => entry.status)).toEqual(["running"])
  })

  test("settles the queued parent's marker during shutdown", async () => {
    // given
    const { manager, directory } = await queueResume()
    // when
    await manager.shutdown()
    // then
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("idle")
  })

  test("logs an admission failure even after the resume token was consumed", async () => {
    // given
    const { internals, task, log } = await queueResume()
    spyOn(internals, "startResumedTask").mockImplementation(async () => {
      task.pendingResume = undefined
      throw new Error("admission-dispatch-failure")
    })
    // when
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(log.mock.calls.some(call => JSON.stringify(call).includes("admission-dispatch-failure"))).toBe(true)
  })

  test("refuses a second continuation while one is queued", async () => {
    // given
    const { manager } = await queueResume("new-parent", true)
    // when
    const second = manager.resume({ sessionId: "child", prompt: "second", parentSessionId: "new-parent", parentMessageId: "third-message" })
    // then
    await expect(second).rejects.toThrow("already has a continuation queued")
  })

  test("cancels a queued continuation without dispatching it", async () => {
    // given
    const { manager, internals, task, promptAsync, directory } = await queueResume("new-parent", true)
    // when
    expect(await manager.cancelTask("resume-review", { source: "test", skipNotification: true })).toBe(true)
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(task.status).toBe("cancelled")
    expect(promptAsync).not.toHaveBeenCalled()
    expect(internals.pendingByParent.has("new-parent")).toBe(false)
    expect(manager.taskHistory.getByParentSession("new-parent").map(entry => entry.status)).toEqual(["cancelled"])
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("idle")
  })

  test("cancels a queued continuation when its parent session is deleted", async () => {
    // given
    const { manager, internals, task, promptAsync, directory } = await queueResume("new-parent", true)
    // when
    manager.handleEvent({ type: "session.deleted", properties: { info: { id: "new-parent" } } })
    await settleAdmission()
    await settleAdmission()
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // then
    expect(task.status).toBe("cancelled")
    expect(promptAsync).not.toHaveBeenCalled()
    expect(internals.pendingByParent.has("new-parent")).toBe(false)
    expect(manager.taskHistory.getByParentSession("new-parent").map(entry => entry.status)).toEqual(["cancelled"])
    expect(readContinuationMarker(directory, "new-parent")?.sources["background-task"]?.state).toBe("idle")
  })

  test("records terminal interrupt history when an admitted resume prompt fails", async () => {
    // given
    const fixture = createResumeFixture()
    const { manager, internals, task, promptAsync } = fixture
    promptAsync.mockImplementation(async () => {
      throw new Error("model unavailable")
    })
    await internals.concurrencyManager.acquire("explore")
    await manager.resume({ sessionId: "child", prompt: "latest", parentSessionId: "new-parent", parentMessageId: "new-message" })
    // when
    internals.concurrencyManager.release("explore")
    await settleAdmission()
    // The failure catch is fire-and-forget; wait for the terminal transition to settle.
    for (let i = 0; i < 100 && task.status !== "interrupt"; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    // then
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(task.status).toBe("interrupt")
    expect(manager.taskHistory.getByParentSession("new-parent").map(entry => entry.status)).toEqual(["interrupt"])
  })

  test("refuses a second resume issued while the first awaits immediate admission", async () => {
    // given
    const { manager, internals, task, promptAsync, directory } = createResumeFixture()
    // when
    const first = manager.resume({ sessionId: "child", prompt: "first", parentSessionId: "first-parent", parentMessageId: "first-message" })
    const second = manager.resume({ sessionId: "child", prompt: "second", parentSessionId: "second-parent", parentMessageId: "second-message" })
    const [firstResult, secondResult] = await Promise.allSettled([first, second])
    await settleAdmission()
    // then
    expect(firstResult.status).toBe("fulfilled")
    expect(secondResult.status).toBe("rejected")
    expect(secondResult.status === "rejected" ? String(secondResult.reason) : "").toContain("already being resumed")
    expect(task.prompt).toBe("first")
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(internals.pendingByParent.has("second-parent")).toBe(false)
    expect(manager.taskHistory.getByParentSession("second-parent")).toEqual([])
    expect(readContinuationMarker(directory, "second-parent")?.sources["background-task"]?.state ?? "idle").toBe("idle")
  })
})
