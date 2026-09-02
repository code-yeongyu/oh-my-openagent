/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { injectContinuation } from "./continuation-injection"
import { createSessionStateStore } from "./session-state"
import {
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"

const GATE_RETRY_DELAY_MS = 5_000
const MAX_GATE_RETRIES = 3

type TimerCallback = (...args: unknown[]) => void
type FakeTimerID = number & ReturnType<typeof setTimeout> & ReturnType<typeof setInterval>

interface FakeTimers {
  advanceBy: (ms: number, advanceClock?: boolean) => Promise<void>
  restore: () => void
}

function createFakeTimers(): FakeTimers {
  const REAL_MAX_DELAY_MS = 60_000
  const originalNow = Date.now()
  let clockNow = originalNow
  let timerNow = 0
  let nextId = 1
  const timers = new Map<number, { id: number; time: number; interval: number | null; callback: TimerCallback; args: unknown[] }>()
  const cleared = new Set<number>()

  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
  }

  const normalizeDelay = (delay?: number) => {
    if (typeof delay !== "number" || !Number.isFinite(delay)) return 0
    return delay < 0 ? 0 : delay
  }

  const flushMicrotasks = async (iterations: number = 25) => {
    for (let index = 0; index < iterations; index++) {
      await Promise.resolve()
    }
  }

  const schedule = (callback: TimerCallback, delay: number | undefined, interval: number | null, args: unknown[]) => {
    const id = nextId++
    timers.set(id, {
      id,
      time: timerNow + normalizeDelay(delay),
      interval,
      callback,
      args,
    })
    return id as FakeTimerID
  }

  const clear = (id: number | undefined) => {
    if (typeof id !== "number") return
    cleared.add(id)
    timers.delete(id)
  }

  globalThis.setTimeout = ((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
    const normalized = normalizeDelay(delay)
    if (normalized >= REAL_MAX_DELAY_MS) {
      return original.setTimeout(callback, delay, ...args)
    }
    return schedule(callback, normalized, null, args)
  }) as typeof setTimeout

  globalThis.setInterval = ((callback: TimerCallback, delay?: number, ...args: unknown[]) => {
    const interval = normalizeDelay(delay)
    if (interval >= REAL_MAX_DELAY_MS) {
      return original.setInterval(callback, interval, ...args)
    }
    return schedule(callback, interval, interval, args)
  }) as typeof setInterval

  globalThis.clearTimeout = ((id?: Parameters<typeof clearTimeout>[0]) => {
    if (typeof id === "number" && timers.has(id)) {
      clear(id)
      return
    }
    original.clearTimeout(id)
  }) as typeof clearTimeout

  globalThis.clearInterval = ((id?: Parameters<typeof clearInterval>[0]) => {
    if (typeof id === "number" && timers.has(id)) {
      clear(id)
      return
    }
    original.clearInterval(id)
  }) as typeof clearInterval

  Date.now = () => clockNow

  const advanceBy = async (ms: number, advanceClock: boolean = false) => {
    const clamped = Math.max(0, ms)
    const target = timerNow + clamped
    if (advanceClock) {
      clockNow += clamped
    }
    while (true) {
      let next: { id: number; time: number; interval: number | null; callback: TimerCallback; args: unknown[] } | undefined
      for (const timer of timers.values()) {
        if (timer.time <= target && (!next || timer.time < next.time)) {
          next = timer
        }
      }
      if (!next) break

      timerNow = next.time
      timers.delete(next.id)
      next.callback(...next.args)

      if (next.interval !== null && !cleared.has(next.id)) {
        timers.set(next.id, {
          id: next.id,
          time: timerNow + next.interval,
          interval: next.interval,
          callback: next.callback,
          args: next.args,
        })
      } else {
        cleared.delete(next.id)
      }

      await flushMicrotasks()
    }
    timerNow = target
    await flushMicrotasks()
  }

  const restore = () => {
    globalThis.setTimeout = original.setTimeout
    globalThis.clearTimeout = original.clearTimeout
    globalThis.setInterval = original.setInterval
    globalThis.clearInterval = original.clearInterval
    Date.now = original.dateNow
  }

  return { advanceBy, restore }
}

describe("continuation injection gate-decline watchdog", () => {
  let fakeTimers: FakeTimers

  beforeEach(() => {
    fakeTimers = createFakeTimers()
  })

  afterEach(() => {
    fakeTimers.restore()
    releaseAllPromptAsyncReservationsForTesting()
  })

  function createCtx(args: {
    readonly sessionID: string
    readonly statusType?: () => string | undefined
    readonly promptCalls?: { count: number }
  }) {
    const promptCalls = args.promptCalls ?? { count: 0 }
    const sessionID = args.sessionID
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
          ...(args.statusType
            ? {
                status: async () => {
                  const statusType = args.statusType?.()
                  return { data: { [sessionID]: { type: statusType ?? "idle" } } }
                },
              }
            : {}),
          promptAsync: async () => {
            promptCalls.count += 1
            return {}
          },
        },
      },
    }
    return { ctx, promptCalls }
  }

  test("#given the gate declines with a transient active status #when the watchdog elapses #then the continuation is re-dispatched", async () => {
    // given - the session reports busy for the first gate read, idle afterwards
    const sessionID = "ses_gate_retry_active"
    let statusReads = 0
    const { ctx, promptCalls } = createCtx({
      sessionID,
      statusType: () => {
        statusReads += 1
        return statusReads <= 1 ? "busy" : "idle"
      },
    })
    const sessionStateStore = createSessionStateStore()

    // when - the first injection is declined by the gate
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore,
    })
    expect(promptCalls.count).toBe(0)

    // then - the watchdog re-dispatches once the transient status settles
    await fakeTimers.advanceBy(GATE_RETRY_DELAY_MS, true)
    expect(promptCalls.count).toBe(1)
    expect(sessionStateStore.getExistingState(sessionID)?.inFlight).toBe(false)
    sessionStateStore.shutdown()
  })

  test("#given the gate declines with a transient reserved status #when the hold is released #then the watchdog re-dispatches", async () => {
    // given - a peer dispatcher holds the reservation past an unrelated release
    const sessionID = "ses_gate_retry_reserved"
    const { ctx, promptCalls } = createCtx({ sessionID })
    const sessionStateStore = createSessionStateStore()

    const peerMessageResult = await dispatchInternalPrompt({
      mode: "async",
      client: {
        session: {
          promptAsync: async () => ({}),
        },
      },
      sessionID,
      source: "team-live-delivery",
      settleMs: 0,
      input: {
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: '<peer_message from="teammate">hello</peer_message>' }] },
      },
    })
    releasePromptAsyncReservation(sessionID, "ralph-loop:activity")
    expect(peerMessageResult.status).toBe("dispatched")

    // when - the injection is declined because the peer hold is still active
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore,
    })
    expect(promptCalls.count).toBe(0)

    // then - releasing the hold lets the watchdog deliver the continuation
    releasePromptAsyncReservation(sessionID, "team-live-delivery")
    await fakeTimers.advanceBy(GATE_RETRY_DELAY_MS, true)
    expect(promptCalls.count).toBe(1)
    sessionStateStore.shutdown()
  })

  test("#given the session stays permanently active #when every watchdog retry is declined #then the retries stop at the bounded budget", async () => {
    // given - the session never leaves the busy status
    const sessionID = "ses_gate_retry_bound"
    const { ctx, promptCalls } = createCtx({
      sessionID,
      statusType: () => "busy",
    })
    const sessionStateStore = createSessionStateStore()

    // when - the initial injection plus every bounded retry is declined
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore,
    })
    await fakeTimers.advanceBy(GATE_RETRY_DELAY_MS * (MAX_GATE_RETRIES + 2), true)

    // then - the dispatch never fired and no retry timer survives the budget
    expect(promptCalls.count).toBe(0)
    expect(sessionStateStore.getExistingState(sessionID)?.gateRetryTimer).toBeUndefined()
    sessionStateStore.shutdown()
  })

  test("#given the gate declines with a permanent unavailable status #when continuation is injected #then no watchdog retry is scheduled", async () => {
    // given - the client exposes no promptAsync capability at all
    const sessionID = "ses_gate_retry_unavailable"
    const ctx = {
      directory: "/tmp/test",
      client: {
        session: {
          todo: async () => ({ data: [{ id: "1", content: "todo", status: "pending", priority: "high" }] }),
        },
      },
    }
    const sessionStateStore = createSessionStateStore()

    // when
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore,
    })
    await fakeTimers.advanceBy(GATE_RETRY_DELAY_MS * 2, true)

    // then - a permanent decline must not spawn retries
    expect(sessionStateStore.getExistingState(sessionID)?.gateRetryTimer).toBeUndefined()
    sessionStateStore.shutdown()
  })

  test("#given a watchdog retry is pending #when the countdown is cancelled #then the retry is torn down with it", async () => {
    // given - the gate declined and a retry is pending
    const sessionID = "ses_gate_retry_cancel"
    const { ctx, promptCalls } = createCtx({
      sessionID,
      statusType: () => "busy",
    })
    const sessionStateStore = createSessionStateStore()
    await injectContinuation({
      ctx: ctx as never,
      sessionID,
      resolvedInfo: {
        agent: "Sisyphus - ultraworker",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      },
      sessionStateStore,
    })
    expect(sessionStateStore.getExistingState(sessionID)?.gateRetryTimer).toBeDefined()

    // when - the abort/stop path cancels the countdown for the session
    sessionStateStore.cancelCountdown(sessionID)
    await fakeTimers.advanceBy(GATE_RETRY_DELAY_MS * 2, true)

    // then - the pending retry never fires
    expect(promptCalls.count).toBe(0)
    expect(sessionStateStore.getExistingState(sessionID)?.gateRetryTimer).toBeUndefined()
    sessionStateStore.shutdown()
  })
})
