import { afterEach, expect, test } from "bun:test"
import { adaptRpcHandle } from "../../manager/child-handle"
import { baseSpec, cleanupProjects, makeManager } from "../../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../../manager/manager"
import { categoryPlanner, settings, tempProject } from "../../manager/__fixtures__/manager-fakes"
import { createTaskRecordStore } from "../../store"
import { fakeClock } from "../rpc/__fixtures__/clock"
import { createHostSessionHandle } from "./handle"
import { fakeSessionPort, FAKE_SESSION } from "./handle.test-support"
import type { HostSessionLiveness } from "./handle-port"
import { hostLivenessText, type HostLivenessStatus } from "../../state/host-liveness"
import { ownedTaskState } from "../../store/__fixtures__/owned-task-state"

let clock: ReturnType<typeof fakeClock>
afterEach(() => {
  clock?.restore()
  cleanupProjects()
})

function stalledSession(confirmClose: () => Promise<void> = () => Promise.resolve()) {
  const delivered = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  const closing = Promise.withResolvers<undefined>()
  const lifecycle: string[] = []
  const port = fakeSessionPort(async (command) => {
    if ("message" in command && command.message === "continue") delivered.resolve(undefined)
    if (command.type === "abort") {
      lifecycle.push("abort")
      aborted.resolve(undefined)
    }
  })
  const state = Promise.withResolvers<HostSessionLiveness>()
  const closed = Promise.withResolvers<undefined>()
  let closes = 0
  const handle = createHostSessionHandle({
    client: {
      ...port,
      getState: () => state.promise,
      closeConfirmed: async () => {
        closes++
        lifecycle.push("close")
        closing.resolve(undefined)
        await closed.promise
        await confirmClose()
      },
    },
    session: FAKE_SESSION,
    taskId: "st_00000001",
    heartbeatIntervalMs: 10_000,
    now: clock.now,
    closeGraceMs: 100,
    openDisposition: "attached",
  })
  return {
    handle,
    port,
    state,
    closed,
    delivered: delivered.promise,
    closes: () => closes,
    aborted: aborted.promise,
    closing: closing.promise,
    lifecycle,
  }
}

test("missed state probes keep the original child nonterminal and recover steering", async () => {
  // Given a host that still holds its session while state replies are stalled.
  clock = fakeClock()
  const h = stalledSession()
  const { manager } = makeManager({
    process: { start: async (spec) => ({ ...adaptRpcHandle(h.handle), task_id: spec.taskId }) },
  })
  const started = await manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))
  if (started.kind !== "started") throw new Error("expected started")
  // When the same probe misses more than three deadlines.
  await clock.advance(45_000)
  // Then no completion or detach is manufactured, and a successful probe restores the same handle.
  expect(h.handle.hasExited()).toBe(false)
  expect(manager.get(started.task_id)?.status).toBe("running")
  expect(h.port.detaches).toBe(0)
  expect(await manager.sendToTask({ idOrName: started.task_id, message: "queued", deliverAs: "steer" })).toMatchObject({
    kind: "queued",
  })
  expect(h.port.sent).toHaveLength(0)
  h.state.resolve({ sessionId: "same-child", isStreaming: true })
  await clock.advance(0)
  const resumedSend = await manager.sendToTask({ idOrName: started.task_id, message: "continue", deliverAs: "steer" })
  expect(["steered", "queued"]).toContain(resumedSend.kind)
  await h.delivered
  expect(h.port.sent.filter((command) => command.type === "steer").map((command) => command.message)).toEqual([
    "queued",
    "continue",
  ])
  manager.forget(started.task_id, { path: "park" })
  await h.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("an overdue session is aborted and closed before reporting terminal", async () => {
  clock = fakeClock()
  const confirmation = Promise.withResolvers<undefined>()
  const confirming = Promise.withResolvers<undefined>()
  const h = stalledSession(() => {
    confirming.resolve(undefined)
    return confirmation.promise
  })
  const terminal = h.handle.waitForExit().then(() => {
    h.lifecycle.push("terminal")
  })
  // When the bounded unresponsive period expires but host absence is not confirmed.
  await clock.advance(170_000)
  await h.aborted
  await h.closing
  expect(h.lifecycle).toEqual(["abort", "close"])
  expect(h.port.sent.some((command) => command.type === "abort")).toBe(true)
  expect(h.closes()).toBeGreaterThan(0)
  expect(h.handle.hasExited()).toBe(false)
  // Then only the confirmed-close port's authoritative proof permits terminal settlement.
  h.closed.resolve(undefined)
  await confirming.promise
  expect(h.handle.hasExited()).toBe(false)
  confirmation.resolve(undefined)
  await terminal
  expect(h.handle.hasExited()).toBe(true)
  expect(h.lifecycle).toEqual(["abort", "close", "terminal"])
  expect(await h.handle.waitForOutcome()).toMatchObject({ status: "error", failure: { kind: "child-unresponsive" } })
  await h.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("an unreachable host never produces a false crashed completion", async () => {
  clock = fakeClock()
  // A host that ANSWERS the confirm with a refusal: every close attempt settles as a failure,
  // so the retry ladder keeps running (a hanging confirm is the next test's subject).
  const refusing = stalledSession(() => Promise.reject(new Error("close refused")))
  await clock.advance(170_000)
  await refusing.closing
  refusing.closed.resolve(undefined)
  // When close keeps being refused, retries continue and ownership is kept.
  await clock.advance(400_000)
  expect(refusing.handle.hasExited()).toBe(false)
  expect(refusing.closes()).toBeGreaterThan(1)
  expect(refusing.port.detaches).toBe(0)
  await refusing.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("a stalled host holds exactly one outstanding close confirm", async () => {
  clock = fakeClock()
  const h = stalledSession()
  // When the close confirm never resolves and many retry ticks fire.
  await clock.advance(400_000)
  // Then only the first attempt opened a confirm; the later ticks joined it instead of piling
  // up new close_session/list_sessions probes against the stalled host (#11347).
  expect(h.closes()).toBe(1)
  expect(h.handle.hasExited()).toBe(false)
  expect(h.port.detaches).toBe(0)
  await h.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("a host that keeps failing the close confirm escalates to the parent exactly once", async () => {
  clock = fakeClock()
  const refusing = stalledSession(() => Promise.reject(new Error("close refused")))
  const statuses: HostLivenessStatus[] = []
  refusing.handle.onLiveness?.((status) => {
    statuses.push(status)
  })
  // When every confirm attempt fails while the retry ladder keeps running.
  await clock.advance(170_000)
  await refusing.closing
  refusing.closed.resolve(undefined)
  await clock.advance(400_000)
  // Then the parent-visible status escalates once and never repeats.
  const escalated = statuses.filter(
    (status): status is Extract<HostLivenessStatus, { state: "terminal-pending" | "unresponsive" }> =>
      status.state !== "running" && status.escalated === true,
  )
  expect(escalated).toHaveLength(1)
  const [first] = escalated
  if (first === undefined) throw new Error("expected one escalated liveness status")
  expect(hostLivenessText(first)).not.toBe(hostLivenessText({ state: "terminal-pending", since: first.since }))
  expect(refusing.handle.hasExited()).toBe(false)
  expect(refusing.closes()).toBeGreaterThan(3)
  await refusing.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("termination releases outcome waiters created before terminal-pending", async () => {
  // Given an early waiter blocked while an overdue session's closure is unconfirmed.
  clock = fakeClock()
  const h = stalledSession()
  let settled = false
  const waiting = h.handle.waitForOutcome().then(() => {
    settled = true
  })
  await clock.advance(170_000)
  expect(settled).toBe(false)
  // When another deliberate exit ends the handle.
  const terminated = h.handle.terminate()
  await clock.advance(0)
  await clock.advance(100)
  await terminated
  // Then that exit releases the existing waiter as well as future waiters.
  expect(h.handle.hasExited()).toBe(true)
  expect(settled).toBe(true)
  await waiting
  await h.handle.dispose()
})

test("a live host's definitive missing-session reply ends the handle immediately", async () => {
  clock = fakeClock()
  const h = stalledSession()
  await clock.advance(10_000)
  h.state.reject(Object.assign(new Error("unknown_session"), { name: "RpcCommandError" }))
  await clock.advance(0)
  expect(h.handle.hasExited()).toBe(true)
  expect(h.closes()).toBe(0)
  await h.handle.dispose()
  expect(clock.pending()).toBe(0)
})

test("the parent observes unresponsive then running without a terminal completion", async () => {
  clock = fakeClock()
  const h = stalledSession()
  const project = tempProject()
  const notices: string[] = []
  const runner = { start: async (spec: { taskId: string }) => ({ ...adaptRpcHandle(h.handle), task_id: spec.taskId }) }
  const options = {
    store: createTaskRecordStore(ownedTaskState(project)),
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config: settings(),
    cwd: project,
    onChildLiveness: (_record: unknown, status: { state: string }) => {
      notices.push(status.state)
    },
  }
  const manager = createTaskManager(options)
  const started = await manager.start(baseSpec({ execution_mode: "process", run_in_background: true }))
  if (started.kind !== "started") throw new Error("expected started")
  try {
    await clock.advance(70_000)
    expect(notices).toEqual(["unresponsive"])
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(manager.get(started.task_id)?.host_liveness).toEqual({ state: "unresponsive", since: 40_000 })
    h.state.resolve({ sessionId: "same-child", isStreaming: true })
    await clock.advance(0)
    await clock.advance(30_000)
    expect(notices).toEqual(["unresponsive", "running"])
    expect(manager.get(started.task_id)?.host_liveness).toEqual({ state: "running" })
  } finally {
    manager.forget(started.task_id, { path: "park" })
    await h.handle.dispose()
  }
})
