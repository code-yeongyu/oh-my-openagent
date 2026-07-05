import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { BackgroundManager } from "../../features/background-agent"
import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createTodoContinuationEnforcer } from "."

type TimerCallback = (...args: readonly unknown[]) => void
type FakeTimerID = number & ReturnType<typeof setTimeout> & ReturnType<typeof setInterval>

interface FakeTimers {
  readonly advanceBy: (ms: number) => Promise<void>
  readonly restore: () => void
}

function createFakeTimers(): FakeTimers {
  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dateNow: Date.now,
  }
  const originalNow = Date.now()
  let clockNow = originalNow
  let timerNow = 0
  let nextId = 1
  const timers = new Map<number, { readonly time: number; readonly callback: TimerCallback; readonly args: readonly unknown[] }>()

  const flushMicrotasks = async (): Promise<void> => {
    for (let index = 0; index < 25; index++) {
      await Promise.resolve()
    }
  }

  globalThis.setTimeout = unsafeTestValue<typeof setTimeout>((callback: TimerCallback, delay?: number, ...args: readonly unknown[]) => {
    const id = nextId++
    const normalizedDelay = typeof delay === "number" && Number.isFinite(delay) ? Math.max(delay, 0) : 0
    timers.set(id, { time: timerNow + normalizedDelay, callback, args })
    return unsafeTestValue<FakeTimerID>(id)
  })

  globalThis.clearTimeout = unsafeTestValue<typeof clearTimeout>((id?: number) => {
    if (typeof id === "number") {
      timers.delete(id)
    }
  })

  Date.now = () => clockNow

  return {
    advanceBy: async (ms: number): Promise<void> => {
      const target = timerNow + ms
      while (true) {
        const next = Array.from(timers.entries())
          .filter(([, timer]) => timer.time <= target)
          .sort(([, left], [, right]) => left.time - right.time)[0]
        if (!next) {
          break
        }
        const [id, timer] = next
        timers.delete(id)
        timerNow = timer.time
        clockNow = originalNow + timerNow
        timer.callback(...timer.args)
        await flushMicrotasks()
      }
      timerNow = target
      clockNow = originalNow + timerNow
      await flushMicrotasks()
    },
    restore: (): void => {
      globalThis.setTimeout = original.setTimeout
      globalThis.clearTimeout = original.clearTimeout
      Date.now = original.dateNow
    },
  }
}

describe("todo-continuation-enforcer parent wake race", () => {
  type MockPluginInput = Parameters<typeof createTodoContinuationEnforcer>[0]

  let fakeTimers: FakeTimers
  let promptCallCount = 0

  function createMockPluginInput(onTodoRead?: () => void): MockPluginInput {
    return unsafeTestValue<MockPluginInput>({
      client: {
        session: {
          messages: async () => ({ data: [] }),
          todo: async () => {
            onTodoRead?.()
            return {
              data: [
                { id: "todo-1", content: "wait for child result", status: "pending", priority: "high" },
              ],
            }
          },
          promptAsync: async () => {
            promptCallCount += 1
            return {}
          },
        },
        tui: {
          showToast: async () => ({}),
        },
      },
      directory: "/tmp/test",
    })
  }

  function createBackgroundManager(hasPendingParentWake: (sessionID: string) => boolean): BackgroundManager {
    return unsafeTestValue<BackgroundManager>({
      getTasksByParentSession: () => [],
      hasActiveChildTasks: () => false,
      hasPendingParentWake,
    })
  }

  beforeEach(() => {
    fakeTimers = createFakeTimers()
    releaseAllPromptAsyncReservationsForTesting()
    _resetForTesting()
    promptCallCount = 0
  })

  afterEach(() => {
    fakeTimers.restore()
    releaseAllPromptAsyncReservationsForTesting()
    _resetForTesting()
  })

  test("#given no active child tasks but a parent wake is pending #when parent session idles with incomplete todos #then continuation is not injected", async () => {
    const sessionID = "main-pending-parent-wake"
    setMainSession(sessionID)
    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {
      backgroundManager: createBackgroundManager((candidateSessionID) => candidateSessionID === sessionID),
    })

    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await fakeTimers.advanceBy(3000)

    expect(promptCallCount).toBe(0)
  })

  test("#given parent wake becomes pending during countdown #when injection rechecks child work #then continuation is not injected", async () => {
    const sessionID = "main-pending-parent-wake-during-countdown"
    setMainSession(sessionID)
    let pendingParentWake = false
    const hook = createTodoContinuationEnforcer(createMockPluginInput(), {
      backgroundManager: createBackgroundManager((candidateSessionID) => pendingParentWake && candidateSessionID === sessionID),
    })

    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    pendingParentWake = true
    await fakeTimers.advanceBy(3000)

    expect(promptCallCount).toBe(0)
  })

  test("#given parent wake becomes pending after todos are refreshed #when injection reaches dispatch #then continuation is not injected", async () => {
    const sessionID = "main-pending-parent-wake-before-dispatch"
    setMainSession(sessionID)
    let pendingParentWake = false
    let todoReads = 0
    const hook = createTodoContinuationEnforcer(createMockPluginInput(() => {
      todoReads += 1
      if (todoReads === 2) {
        pendingParentWake = true
      }
    }), {
      backgroundManager: createBackgroundManager((candidateSessionID) => pendingParentWake && candidateSessionID === sessionID),
    })

    await hook.handler({
      event: { type: "session.idle", properties: { sessionID } },
    })
    await fakeTimers.advanceBy(3000)

    expect(todoReads).toBe(2)
    expect(promptCallCount).toBe(0)
  })
})
