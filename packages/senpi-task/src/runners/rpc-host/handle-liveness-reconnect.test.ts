import { afterEach, expect, test } from "bun:test"
import { AsyncResource } from "node:async_hooks"
import { fakeClock } from "../rpc/__fixtures__/clock"
import { createHostSessionHandle } from "./handle"
import { fakeSessionPort, FAKE_SESSION } from "./handle.test-support"
import type { HostSessionLiveness } from "./handle-port"

let clock: ReturnType<typeof fakeClock>
afterEach(() => clock?.restore())

/**
 * Awaits one of this test's gate promises and names it when it can provably never settle. Every
 * handle timer rides the fake clock, so a gate still unsettled after the microtask queue is
 * drained can only settle through a fake timer: the drain runs every such timer this handle could
 * still react to (bounded fake time, far past this test's last assertion). A gate unsettled after
 * that can never settle, and the wait fails with the event's name and the observed liveness states
 * instead of hanging until the suite timeout. No wall-clock deadline is involved, so the test's
 * own budget is unchanged, and the healthy path settles before the drain and never runs it.
 */
async function awaitNamed(
  event: string,
  gate: Promise<void>,
  observedStates: readonly string[],
  drainFakeClock: () => Promise<void>,
): Promise<void> {
  let settled = false
  void gate.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  if (settled) {
    await gate
    return
  }
  await drainFakeClock()
  await new Promise<void>((resolve) => setImmediate(resolve))
  if (!settled) {
    throw new Error(`${event} never arrived; observed liveness states: ${observedStates.join(" -> ") || "none"}`)
  }
  await gate
}

test("a connection lost while unresponsive reattaches the same session before the deadline", async () => {
  clock = fakeClock()
  const first = fakeSessionPort()
  const state = Promise.withResolvers<HostSessionLiveness>()
  const recovered = fakeSessionPort()
  await recovered.answerState({ sessionId: "same-child", isStreaming: true })
  const reattachStarted = Promise.withResolvers<void>()
  const releaseReattach = Promise.withResolvers<void>()
  let attaches = 0
  const handle = createHostSessionHandle({
    client: { ...first, getState: () => state.promise },
    session: FAKE_SESSION,
    taskId: "st_reconnect",
    heartbeatIntervalMs: 10_000,
    now: clock.now,
    closeGraceMs: 100,
    openDisposition: "attached",
    reattach: async (session) => {
      expect(session.sessionPath).toBe(FAKE_SESSION.sessionPath)
      attaches++
      reattachStarted.resolve()
      await releaseReattach.promise
      return { client: recovered, session: FAKE_SESSION, attached: true }
    },
  })
  try {
    await clock.advance(45_000)
    expect(handle.liveness().state).toBe("unresponsive")
    const running = Promise.withResolvers<void>()
    const observedStates: string[] = []
    const unsubscribe = handle.onLiveness((status) => {
      observedStates.push(status.state)
      if (status.state === "running") running.resolve()
    })
    first.loseTransport()
    state.reject(Object.assign(new Error("transport lost"), { code: "rpc_transport_gone" }))
    await clock.advance(0)
    await clock.advance(30_000)
    const drainFakeClock = async () => {
      for (let step = 0; step < 60; step += 1) await clock.advance(10_000)
    }
    await awaitNamed("reattach start", reattachStarted.promise, observedStates, drainFakeClock)
    // Advancing the clock starts the retry; it does not acknowledge an async reattach.
    expect(handle.liveness().state).toBe("unresponsive")
    releaseReattach.resolve()
    await awaitNamed("liveness recovery to running", running.promise, observedStates, drainFakeClock)
    unsubscribe()
    // Cross the original unresponsive deadline only after the recovered probe cleared it.
    await clock.advance(120_000)
    expect(handle.hasExited()).toBe(false)
    expect(handle.liveness().state).toBe("running")
    await handle.steer("same task")
    expect(attaches).toBe(1)
    expect(recovered.sent.filter((command) => command.type === "steer")).toHaveLength(1)
    expect(recovered.sent.some((command) => command.type === "prompt")).toBe(false)
  } finally {
    releaseReattach.resolve()
    await handle.dispose()
  }
  expect(clock.pending()).toBe(0)
})

test("late state and child events cannot undo an overdue session's pending close", async () => {
  const ambient = new AsyncResource("unrelated task")
  let ambientTimer: ReturnType<typeof setTimeout> | undefined
  clock = fakeClock()
  const first = fakeSessionPort()
  const state = Promise.withResolvers<HostSessionLiveness>()
  const closed = Promise.withResolvers<undefined>()
  const handle = createHostSessionHandle({
    client: { ...first, getState: () => state.promise, closeConfirmed: () => closed.promise },
    session: FAKE_SESSION,
    taskId: "st_closing",
    heartbeatIntervalMs: 10_000,
    now: clock.now,
    closeGraceMs: 100,
    openDisposition: "attached",
  })
  try {
    await clock.advance(170_000)
    state.resolve({ sessionId: "same-child", isStreaming: true })
    first.emitEvent({ type: "agent_start" })
    await clock.advance(0)
    expect(handle.hasExited()).toBe(false)
    expect(handle.liveness().state).toBe("terminal-pending")
    const send = await handle.steer("must not run").catch((error: unknown) => error)
    expect(send).toMatchObject({ code: "unresponsive", retryable: true })
    // Work already running in another session can schedule a timer during this close wait.
    // It must remain real and must not count as a timer owned by this handle.
    ambient.runInAsyncScope(() => {
      ambientTimer = setTimeout(() => {}, 500)
    })
    closed.resolve(undefined)
    await clock.advance(0)
    expect(handle.hasExited()).toBe(true)
    await handle.dispose()
    expect(clock.pending()).toBe(0)
  } finally {
    clearTimeout(ambientTimer)
    ambient.emitDestroy()
    await handle.dispose()
  }
})

test("a stale missing-session probe cannot confirm a later pending close", async () => {
  // Given a probe sent before the deadline and a close still lacking authoritative confirmation.
  clock = fakeClock()
  const port = fakeSessionPort()
  const state = Promise.withResolvers<HostSessionLiveness>()
  const closed = Promise.withResolvers<undefined>()
  const handle = createHostSessionHandle({
    client: { ...port, getState: () => state.promise, closeConfirmed: () => closed.promise },
    session: FAKE_SESSION,
    taskId: "st_stale_probe",
    heartbeatIntervalMs: 10_000,
    now: clock.now,
    closeGraceMs: 100,
    openDisposition: "attached",
  })
  try {
    await clock.advance(170_000)
    // When the old probe finally answers not-found, it is not a post-close observation.
    state.reject(Object.assign(new Error("unknown_session"), { errorCode: "unknown_session" }))
    await clock.advance(0)
    // Then the handle continues waiting for a fresh closure proof.
    expect(handle.hasExited()).toBe(false)
    expect(handle.liveness().state).toBe("terminal-pending")
  } finally {
    await handle.dispose()
  }
})

test("disposing during an unacknowledged abort cancels all liveness timers", async () => {
  clock = fakeClock()
  const abort = Promise.withResolvers<undefined>()
  const port = fakeSessionPort(() => abort.promise)
  const handle = createHostSessionHandle({
    client: port,
    session: FAKE_SESSION,
    taskId: "st_dispose",
    heartbeatIntervalMs: 10_000,
    now: clock.now,
    closeGraceMs: 2_000,
    openDisposition: "attached",
  })
  await clock.advance(160_000)
  expect(handle.liveness().state).toBe("terminal-pending")
  await handle.dispose()
  await clock.advance(0)
  expect(clock.pending()).toBe(0)
  expect(port.closes).toBe(0)
})
