import { afterEach, describe, expect, jest, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createIdleNotificationScheduler } from "./session-notification-scheduler"

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createDeferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise,
  }
}

describe("session-notification-scheduler", () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test("does not resend when notification version entry is evicted during delivery", async () => {
    jest.useFakeTimers()

    const firstSendGate = createDeferred<void>()
    let firstSendStarted = false
    const sendCalls: string[] = []

    const scheduler = createIdleNotificationScheduler({
      ctx: {} as PluginInput,
      platform: "darwin",
      config: {
        playSound: false,
        soundPath: "",
        idleConfirmationDelay: 10,
        skipIfIncompleteTodos: false,
        maxTrackedSessions: 1,
        activityGracePeriodMs: 0,
      },
      hasIncompleteTodos: async () => false,
      send: async (_ctx, _platform, sessionID) => {
        sendCalls.push(sessionID)

        if (sessionID !== "session-a") {
          return true
        }

        firstSendStarted = true
        await firstSendGate.promise

        return true
      },
      playSound: async () => {},
    })

    scheduler.scheduleIdleNotification("session-a")
    jest.advanceTimersByTime(10)
    await flushMicrotasks()

    expect(sendCalls).toEqual(["session-a"])

    scheduler.scheduleIdleNotification("session-b")
    jest.advanceTimersByTime(10)
    await flushMicrotasks()

    expect(sendCalls).toEqual(["session-a", "session-b"])

    if (!firstSendStarted) {
      throw new Error("Expected the first send call to be in-flight")
    }

    firstSendGate.resolve()
    await flushMicrotasks()

    scheduler.scheduleIdleNotification("session-a")
    jest.advanceTimersByTime(10)
    await flushMicrotasks()

    const sessionASendCount = sendCalls.filter(id => id === "session-a").length
    expect(sessionASendCount).toBe(1)
  })
})
