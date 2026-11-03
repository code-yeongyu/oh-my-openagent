import { afterEach, expect, test } from "bun:test"
import { fakeClock } from "../rpc/__fixtures__/clock"
import { createHostSessionHandle } from "./handle"
import { fakeSessionPort, FAKE_SESSION } from "./handle.test-support"
import type { HostSessionLiveness } from "./handle-port"

let clock: ReturnType<typeof fakeClock>
afterEach(() => clock?.restore())

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
    client: { ...first, getState: () => state.promise }, session: FAKE_SESSION,
    taskId: "st_reconnect", heartbeatIntervalMs: 10_000, now: clock.now, closeGraceMs: 100,
    openDisposition: "attached",
    reattach: async session => {
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
    const unsubscribe = handle.onLiveness(status => {
      if (status.state === "running") running.resolve()
    })
    first.loseTransport()
    state.reject(Object.assign(new Error("transport lost"), { code: "rpc_transport_gone" }))
    await clock.advance(0)
    await clock.advance(30_000)
    await reattachStarted.promise
    // Advancing the clock starts the retry; it does not acknowledge an async reattach.
    expect(handle.liveness().state).toBe("unresponsive")
    releaseReattach.resolve()
    await running.promise
    unsubscribe()
    // Cross the original unresponsive deadline only after the recovered probe cleared it.
    await clock.advance(120_000)
    expect(handle.hasExited()).toBe(false)
    expect(handle.liveness().state).toBe("running")
    await handle.steer("same task")
    expect(attaches).toBe(1)
    expect(recovered.sent.filter(command => command.type === "steer")).toHaveLength(1)
    expect(recovered.sent.some(command => command.type === "prompt")).toBe(false)
  } finally {
    releaseReattach.resolve()
    await handle.dispose()
  }
  expect(clock.pending()).toBe(0)
})

test("late state and child events cannot undo an overdue session's pending close", async () => {
  clock = fakeClock()
  const first = fakeSessionPort()
  const state = Promise.withResolvers<HostSessionLiveness>()
  const closed = Promise.withResolvers<undefined>()
  const handle = createHostSessionHandle({
    client: { ...first, getState: () => state.promise, closeConfirmed: () => closed.promise },
    session: FAKE_SESSION, taskId: "st_closing", heartbeatIntervalMs: 10_000,
    now: clock.now, closeGraceMs: 100, openDisposition: "attached",
  })
  await clock.advance(170_000)
  state.resolve({ sessionId: "same-child", isStreaming: true })
  first.emitEvent({ type: "agent_start" })
  await clock.advance(0)
  expect(handle.hasExited()).toBe(false)
  expect(handle.liveness().state).toBe("terminal-pending")
  const send = await handle.steer("must not run").catch((error: unknown) => error)
  expect(send).toMatchObject({ code: "unresponsive", retryable: true })
  closed.resolve(undefined)
  await clock.advance(0)
  expect(handle.hasExited()).toBe(true)
  await handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("a stale missing-session probe cannot confirm a later pending close", async () => {
  // Given a probe sent before the deadline and a close still lacking authoritative confirmation.
  clock = fakeClock()
  const port = fakeSessionPort()
  const state = Promise.withResolvers<HostSessionLiveness>()
  const closed = Promise.withResolvers<undefined>()
  const handle = createHostSessionHandle({
    client: { ...port, getState: () => state.promise, closeConfirmed: () => closed.promise },
    session: FAKE_SESSION, taskId: "st_stale_probe", heartbeatIntervalMs: 10_000,
    now: clock.now, closeGraceMs: 100, openDisposition: "attached",
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
    client: port, session: FAKE_SESSION, taskId: "st_dispose", heartbeatIntervalMs: 10_000,
    now: clock.now, closeGraceMs: 2_000, openDisposition: "attached",
  })
  await clock.advance(160_000)
  expect(handle.liveness().state).toBe("terminal-pending")
  await handle.dispose()
  await clock.advance(0)
  expect(clock.pending()).toBe(0)
  expect(port.closes).toBe(0)
})
