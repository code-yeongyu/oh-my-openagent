/// <reference types="bun-types" />

// Task 1 (RED lock): pin the bug where a successfully-completed background task
// whose output was already consumed in the same parent turn via background_output
// STILL triggers a redundant "completed" parent wake. These tests exercise the
// BackgroundManager + ParentWakeNotifier wake path with fake timers, mirroring
// task-completion-cleanup.test.ts. They must FAIL against current production code
// for the suppression scenarios (1, 4) and PASS for the guard scenarios (2, 3)
// that pin the scope of future suppression (only completed-success is suppressible).

import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import {
  clearBackgroundOutputConsumptionState,
  recordBackgroundOutputConsumption,
} from "../../shared/background-output-consumption"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
    parts?: unknown[]
  }
  query?: {
    directory: string
  }
}

type SessionMessageForTest = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: number }
  }
  parts?: Array<{ type?: string; state?: { status?: string } }>
}

type FakeTimers = {
  getDelay: (timer: ReturnType<typeof setTimeout>) => number | undefined
  run: (timer: ReturnType<typeof setTimeout>) => Promise<void>
  advanceBy: (ms: number) => Promise<void>
  runNext: () => Promise<boolean>
  restore: () => void
}

type PendingParentWakeForTest = {
  promptContext?: Record<string, unknown>
  notifications: string[]
  shouldReply: boolean
  toolCallDeferralStartedAt?: number
}

let managerUnderTest: BackgroundManager | undefined
let fakeTimers: FakeTimers | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  fakeTimers?.restore()
  releaseAllPromptAsyncReservationsForTesting()
  clearBackgroundOutputConsumptionState()
  managerUnderTest = undefined
  fakeTimers = undefined
})

function createTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  const id = overrides.id
  const parentSessionID = overrides.parentSessionId
  const { id: _ignoredID, parentSessionId: _ignoredParentSessionID, ...rest } = overrides

  return {
    parentMessageId: overrides.parentMessageId ?? "parent-message-id",
    description: overrides.description ?? overrides.id,
    prompt: overrides.prompt ?? `Prompt for ${overrides.id}`,
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? new Date("2026-03-11T00:00:00.000Z"),
    ...rest,
    id,
    parentSessionId: parentSessionID,
  }
}

function createManager(enableParentSessionNotifications: boolean): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
}
function createManager(
  enableParentSessionNotifications: boolean,
  sessionStatuses?: Record<string, { type: string }>,
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>,
  sessionMessages: SessionMessageForTest[] = [],
): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
} {
  if (enableParentSessionNotifications && !fakeTimers) {
    fakeTimers = installFakeTimers()
  }

  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => sessionMessages,
      status: async () => ({ data: sessionStatuses ?? {} }),
      prompt: async () => ({}),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        if (promptAsyncImpl) {
          return promptAsyncImpl(call)
        }
        return {}
      },
      abort: async () => ({}),
    },
  }
  const ctx: PluginInput = {
    client: client as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
    experimental_workspace: {} as PluginInput["experimental_workspace"],
  }

  const manager = new BackgroundManager(
    { pluginContext: ctx, config: undefined, enableParentSessionNotifications }
  )

  return { manager, promptAsyncCalls }
}

function installFakeTimers(): FakeTimers {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalDateNow = Date.now
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void | Promise<void>>()
  const delays = new Map<ReturnType<typeof setTimeout>, number>()
  const dueTimes = new Map<ReturnType<typeof setTimeout>, number>()
  let now = Date.now()

  globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    if (typeof handler !== "function") {
      throw new Error("Expected function timeout handler")
    }

    const timer = originalSetTimeout(() => {}, 60_000)
    originalClearTimeout(timer)
    const callback = handler as (...callbackArgs: Array<unknown>) => void
    callbacks.set(timer, () => callback(...args))
    const normalizedDelay = Math.max(0, delay ?? 0)
    delays.set(timer, normalizedDelay)
    dueTimes.set(timer, now + normalizedDelay)
    return timer
  }) as typeof setTimeout

  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>): void => {
    callbacks.delete(timer)
    delays.delete(timer)
    dueTimes.delete(timer)
  }) as typeof clearTimeout
  Date.now = () => now

  return {
    getDelay(timer) {
      return delays.get(timer)
    },
    async run(timer) {
      const callback = callbacks.get(timer)
      if (!callback) {
        throw new Error(`Timer not found: ${String(timer)}`)
      }

      now = dueTimes.get(timer) ?? now
      callbacks.delete(timer)
      delays.delete(timer)
      dueTimes.delete(timer)
      await callback()
      await flushMicrotasks()
    },
    async advanceBy(ms) {
      const target = now + ms
      while (true) {
        const nextTimer = nextTimerDueBefore(target)
        if (!nextTimer) break
        await this.run(nextTimer)
      }
      now = target
      await flushMicrotasks()
    },
    async runNext() {
      const nextTimer = nextTimerDueBefore(Number.POSITIVE_INFINITY)
      if (!nextTimer) {
        await flushMicrotasks()
        return false
      }
      await this.run(nextTimer)
      return true
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      Date.now = originalDateNow
    },
  }

  function nextTimerDueBefore(target: number): ReturnType<typeof setTimeout> | undefined {
    return [...dueTimes.entries()]
      .filter(([, dueAt]) => dueAt <= target)
      .sort((left, right) => left[1] - right[1])[0]?.[0]
  }
}

function getTasks(manager: BackgroundManager): Map<string, BackgroundTask> {
  return Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, PendingParentWakeForTest> {
  const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as {
    getPendingParentWakes: () => Map<string, PendingParentWakeForTest>
  }
  return parentWakeNotifier.getPendingParentWakes()
}

function getPendingParentWakeTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as {
    getPendingParentWakeTimers: () => Map<string, ReturnType<typeof setTimeout>>
  }
  return parentWakeNotifier.getPendingParentWakeTimers()
}

async function notifyParentSessionForTest(manager: BackgroundManager, task: BackgroundTask): Promise<void> {
  const notifyParentSession = Reflect.get(manager, "notifyParentSession") as (task: BackgroundTask) => Promise<void>
  return notifyParentSession.call(manager, task)
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

async function flushParentWake(manager: BackgroundManager, sessionID = "parent-1"): Promise<void> {
  if (!fakeTimers) {
    throw new Error("Fake timers must be installed before flushing parent wakes")
  }

  const pendingTimer = getPendingParentWakeTimers(manager).get(sessionID)
  if (pendingTimer) {
    await fakeTimers.run(pendingTimer)
  } else {
    const flushPendingParentWake = Reflect.get(manager, "flushPendingParentWake") as (id: string) => Promise<void>
    void flushPendingParentWake.call(manager, sessionID)
    await flushMicrotasks()
  }

  await fakeTimers.advanceBy(151)
}

async function waitForDeferredWake(manager: BackgroundManager, promptAsyncCalls: PromptAsyncCall[]): Promise<void> {
  if (!fakeTimers) {
    throw new Error("Fake timers must be installed before waiting for parent wakes")
  }

  for (let attempts = 0; attempts < 12 && promptAsyncCalls.length === 0; attempts += 1) {
    await flushParentWake(manager)
    if (promptAsyncCalls.length > 0) break
    await fakeTimers.runNext()
  }
}

function waitForCoalescedFlush(manager: BackgroundManager, promptAsyncCalls: PromptAsyncCall[]): Promise<void> {
  return waitForDeferredWake(manager, promptAsyncCalls)
}

function getPromptText(call: PromptAsyncCall | undefined): string {
  return JSON.stringify(call?.body.parts ?? [])
}

describe("consumed background task output should not trigger a redundant completed wake", () => {
  test("#given a completed task whose output was consumed in the same parent turn after the wake was queued #when the wake is flushed #then no completed wake is sent to the parent", async () => {
    // given - single completed task, idle parent, wake already queued by completion
    const { manager, promptAsyncCalls } = createManager(true)
    managerUnderTest = manager
    const task = createTask({
      id: "bg_consumed_success",
      parentSessionId: "parent-1",
      sessionId: "ses_consumed_success",
      description: "consumed success task",
      status: "completed",
      completedAt: new Date("2026-03-11T00:01:00.000Z"),
    })
    getTasks(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when - completion queues/debounces the wake FIRST
    await notifyParentSessionForTest(manager, task)
    // then the parent consumes the output in the same turn (records consumption)
    recordBackgroundOutputConsumption(task.parentSessionId, task.parentMessageId, task.sessionId)
    // flush the deferred wake
    await waitForCoalescedFlush(manager, promptAsyncCalls)

    // then - the redundant completed wake must NOT have been dispatched
    expect(promptAsyncCalls).toHaveLength(0)
    expect(getPendingParentWakes(manager).has(task.parentSessionId)).toBe(false)
  })

  test("#given an unconsumed completed task #when the wake is flushed #then exactly one completed wake fires naming the task id", async () => {
    // given - single completed task, idle parent, NO consumption recorded
    const { manager, promptAsyncCalls } = createManager(true)
    managerUnderTest = manager
    const task = createTask({
      id: "bg_unconsumed_success",
      parentSessionId: "parent-1",
      sessionId: "ses_unconsumed_success",
      description: "unconsumed success task",
      status: "completed",
      completedAt: new Date("2026-03-11T00:01:00.000Z"),
    })
    getTasks(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when - completion queues the wake, nothing consumes, then flush
    await notifyParentSessionForTest(manager, task)
    await waitForCoalescedFlush(manager, promptAsyncCalls)

    // then - exactly one wake fires and it names the task + completion marker
    expect(promptAsyncCalls).toHaveLength(1)
    const payload = getPromptText(promptAsyncCalls[0])
    expect(payload).toContain("ALL BACKGROUND TASKS COMPLETE")
    expect(payload).toContain(task.id)
    expect(payload).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })

  describe("#given a terminal-but-failed task whose output was inspected (consumption recorded)", () => {
    for (const terminalStatus of ["error", "cancelled", "interrupt"] as const) {
      test(`#when status is ${terminalStatus} #then a wake STILL fires after inspection (suppression scope is completed-success only)`, async () => {
        // given
        const parentSessionID = `parent-${terminalStatus}`
        const { manager, promptAsyncCalls } = createManager(true)
        managerUnderTest = manager
        const task = createTask({
          id: `bg_${terminalStatus}`,
          parentSessionId: parentSessionID,
          sessionId: `ses_${terminalStatus}`,
          description: `${terminalStatus} task`,
          status: terminalStatus,
          completedAt: new Date("2026-03-11T00:01:00.000Z"),
          ...(terminalStatus === "error" ? { error: "boom" } : {}),
        })
        getTasks(manager).set(task.id, task)
        getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

        // when - parent inspects the failed output (records consumption), completion queues wake, flush
        recordBackgroundOutputConsumption(task.parentSessionId, task.parentMessageId, task.sessionId)
        await notifyParentSessionForTest(manager, task)
        await waitForCoalescedFlush(manager, promptAsyncCalls)

        // then - a wake STILL fires naming the failed task (never suppressed)
        expect(promptAsyncCalls).toHaveLength(1)
        const payload = getPromptText(promptAsyncCalls[0])
        expect(payload).toContain(task.id)
      })
    }
  })

  test("#given two terminal tasks (one consumed success + one failure) for the same parent #when the all-complete wake flushes #then the consumed success is absent but the failure is reported", async () => {
    // given - one consumed completed success and one failure sharing a parent
    const { manager, promptAsyncCalls } = createManager(true)
    managerUnderTest = manager
    const successTask = createTask({
      id: "bg_grouped_success",
      parentSessionId: "parent-grouped",
      sessionId: "ses_grouped_success",
      description: "grouped consumed success",
      status: "completed",
      completedAt: new Date("2026-03-11T00:01:00.000Z"),
    })
    const failedTask = createTask({
      id: "bg_grouped_failure",
      parentSessionId: "parent-grouped",
      sessionId: "ses_grouped_failure",
      description: "grouped failure",
      status: "error",
      completedAt: new Date("2026-03-11T00:02:00.000Z"),
      error: "failed hard",
    })
    getTasks(manager).set(successTask.id, successTask)
    getTasks(manager).set(failedTask.id, failedTask)
    getPendingByParent(manager).set(successTask.parentSessionId, new Set([successTask.id, failedTask.id]))

    // when - the success is consumed BEFORE the grouped notification is generated
    recordBackgroundOutputConsumption(successTask.parentSessionId, successTask.parentMessageId, successTask.sessionId)
    await notifyParentSessionForTest(manager, successTask)
    await notifyParentSessionForTest(manager, failedTask)
    await waitForCoalescedFlush(manager, promptAsyncCalls)

    // then - exactly one all-complete wake fires (the failure forces a reply)
    expect(promptAsyncCalls).toHaveLength(1)
    const payload = getPromptText(promptAsyncCalls[0])
    expect(payload).toContain(failedTask.id)
    expect(payload).toContain("FAILED")
    // RED today: the consumed success is still listed because no filtering exists
    expect(payload).not.toContain(successTask.id)
    expect(payload).not.toContain(successTask.description)
  })
})
