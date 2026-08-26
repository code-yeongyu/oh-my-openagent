import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"
import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge session_start recovery chain", () => {
  it("#given a resumed session with a revived record #when session_start fires #then the chain runs in the planned order with the session id threaded", async () => {
    const revived = { task_id: "task-revived" } as TaskRecord
    const { pi, order, reconcileCalls, notifyCalls, livenessCalls, resumptionCalls } = wireHarness("parent-session", {
      outcomes: [
        { task_id: "task-revived", kind: "resumed" },
        { task_id: "task-gone", kind: "resumed" },
      ],
      records: { "task-revived": revived },
      resumptionChannelCount: 2,
    })

    await pi.dispatch("session_start", {}, {})

    expect(order).toEqual([
      "capture",
      "onSessionStart",
      "reconcile",
      "liveness:task-revived",
      "resumptionStart:2",
      "reclaim",
      "notify",
      "cleanup:start",
      "cleanup:end",
      "poll",
      "statusSync",
    ])
    expect(reconcileCalls).toEqual(["parent-session"])
    expect(notifyCalls).toEqual([{ sessionId: "parent-session", parentState: { kind: "idle" } }])
    expect(livenessCalls).toEqual(["task-revived"])
    expect(resumptionCalls).toEqual([2])
  })

  it("#given no captured session id #when session_start fires #then the legacy sweep still runs with undefined while the scoped notification branch is skipped", async () => {
    const { pi, order, reconcileCalls, notifyCalls, warnings } = wireHarness(undefined)

    await pi.dispatch("session_start", {}, {})

    expect(reconcileCalls).toEqual([undefined])
    expect(notifyCalls).toHaveLength(0)
    expect(order).toEqual([
      "capture",
      "onSessionStart",
      "reconcile",
      "resumptionStart:0",
      "reclaim",
      "cleanup:start",
      "cleanup:end",
      "poll",
      "statusSync",
    ])
    expect(warnings).toHaveLength(0)
  })

  it("#given a terminal child persisted before restart #when reconcile returns no outcome #then session_start still re-observes it for liveness", async () => {
    const terminal = {
      task_id: "task-terminal",
      parent_session_id: "parent-session",
    } as TaskRecord
    const { pi, livenessCalls } = wireHarness("parent-session", {
      outcomes: [],
      records: { "task-terminal": terminal },
    })

    await pi.dispatch("session_start", {}, {})

    expect(livenessCalls).toEqual(["task-terminal"])
  })

  it("#given expired records #when session_start fires #then the awaited ttl cleanup runs after notification reconcile and logs deletions", async () => {
    const { pi, order, infos } = wireHarness("parent-session", { cleanupDeleted: ["task-old"] })

    await pi.dispatch("session_start", {}, {})

    expect(order.indexOf("cleanup:start")).toBeGreaterThan(order.indexOf("notify"))
    expect(order.indexOf("poll")).toBeGreaterThan(order.indexOf("cleanup:end"))
    expect(infos).toHaveLength(1)
    expect(infos[0]?.message).toContain("ttl cleanup")
  })
})

describe("event-bridge session_shutdown", () => {
  it("#given a session_shutdown with a reason and a captured session id #when the event fires #then it suspends with parentSessionId and reason", async () => {
    const { pi, calls, order } = wireHarness("parent-session")

    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" } as SessionShutdownEvent,
      {},
    )

    expect(order).toEqual([
      "capture",
      "transition",
      "clearUi",
      "dispose",
      "leadShutdown",
      "resumptionShutdown:0",
      "suspend",
    ])
    expect(calls).toEqual([{ parentSessionId: "parent-session", reason: "quit" }])
  })

  it("#given a session_shutdown with no captured session id #when the event fires #then it warns and does not suspend", async () => {
    const { pi, calls, order, warnings } = wireHarness(undefined)

    await pi.dispatch(
      "session_shutdown",
      { type: "session_shutdown", reason: "reload" } as SessionShutdownEvent,
      {},
    )

    expect(order).toEqual([
      "capture",
      "transition",
      "clearUi",
      "dispose",
      "leadShutdown",
      "resumptionShutdown:0",
    ])
    expect(calls).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain("session id")
  })

  it("#given a session_shutdown with a missing reason #when the event fires #then it warns and does not suspend", async () => {
    const { pi, calls, warnings } = wireHarness("parent-session")

    await pi.dispatch("session_shutdown", { type: "session_shutdown" } as unknown as SessionShutdownEvent, {})

    expect(calls).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain("reason")
  })
})
