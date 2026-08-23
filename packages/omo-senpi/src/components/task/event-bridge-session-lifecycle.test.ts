import { describe, expect, it } from "bun:test"

import type { SessionShutdownEvent } from "@code-yeongyu/senpi"
import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import { inferPrintMode } from "./event-bridge"
import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge session_start recovery chain", () => {
  it("#given a resumed session with a revived record #when session_start fires #then the chain runs in the planned order with the session id threaded", async () => {
    const revived = { task_id: "task-revived" } as TaskRecord
    const { pi, order, reconcileCalls, notifyCalls, livenessCalls, resumptionCalls } = wireHarness("parent-session", {
      mode: "json",
      outcomes: [
        { task_id: "task-revived", kind: "resumed" },
        { task_id: "task-gone", kind: "resumed" },
      ],
      records: { "task-revived": revived },
      resumptionChannelCount: 2,
    })

    await pi.dispatch("session_start", {}, {})

    expect(order).toEqual(["capture", "onSessionStart"])
    expect(reconcileCalls).toEqual([])
    expect(notifyCalls).toEqual([])
    expect(livenessCalls).toEqual([])
    expect(resumptionCalls).toEqual([])
  })

  it("#given print-mode session_start #when before_agent_start fires #then deferred reconcile and liveness run", async () => {
    const revived = { task_id: "task-revived" } as TaskRecord
    const { pi, reconcileCalls, livenessCalls, notifyCalls } = wireHarness("parent-session", {
      mode: "json",
      outcomes: [{ task_id: "task-revived", kind: "resumed" }],
      records: { "task-revived": revived },
    })

    await pi.dispatch("session_start", {}, {})
    expect(reconcileCalls).toEqual([])
    expect(livenessCalls).toEqual([])

    await pi.dispatch("before_agent_start", {}, {})
    expect(reconcileCalls).toEqual(["parent-session"])
    expect(livenessCalls).toEqual(["task-revived"])
    expect(notifyCalls).toEqual([{ sessionId: "parent-session", parentState: { kind: "session_switching" } }])
  })

  it("#given a print-mode deferred recovery #when the session switches away #then before_agent_start does not run it", async () => {
    const { pi, reconcileCalls, livenessCalls } = wireHarness("parent-session", { mode: "json" })

    await pi.dispatch("session_start", {}, {})
    await pi.dispatch("session_before_switch", {}, {})
    await pi.dispatch("before_agent_start", {}, {})

    expect(reconcileCalls).toEqual([])
    expect(livenessCalls).toEqual([])
  })

  it("#given an interactive TUI session start #when session_start fires #then owed completions redeliver as idle", async () => {
    const { pi, notifyCalls } = wireHarness("parent-session", { mode: "tui" })

    await pi.dispatch("session_start", {}, {})

    expect(notifyCalls).toEqual([{ sessionId: "parent-session", parentState: { kind: "idle" } }])
  })

  it("#given a runtime that omits mode #when session_start fires #then it is treated as interactive and redelivers as idle", async () => {
    const { pi, notifyCalls } = wireHarness("parent-session")

    await pi.dispatch("session_start", {}, {})

    expect(notifyCalls).toEqual([{ sessionId: "parent-session", parentState: { kind: "idle" } }])
  })

  it("#given a print-mode recovery buffer #when the resumed prompt reaches agent_end #then that buffer flushes once", async () => {
    const { pi, flushCalls } = wireHarness("parent-session", { mode: "json" })

    await pi.dispatch("session_start", {}, {})
    await pi.dispatch("agent_end", {}, {})
    await pi.dispatch("agent_end", {}, {})

    expect(flushCalls).toEqual([{ sessionId: "parent-session", replaced: false }])
  })

  it("#given a transition after print-mode recovery #when agent_end fires #then transition-owned completions remain buffered", async () => {
    const { pi, flushCalls } = wireHarness("parent-session", { mode: "json" })

    await pi.dispatch("session_start", {}, {})
    await pi.dispatch("session_before_switch", {}, {})
    await pi.dispatch("agent_end", {}, {})

    expect(flushCalls).toEqual([])
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

describe("inferPrintMode", () => {
  it("#given mode json #then it is print mode", () => {
    expect(inferPrintMode("json", [])).toBe(true)
  })

  it("#given an explicit non-json mode #then it is not print mode", () => {
    expect(inferPrintMode("tui", ["--mode", "json"])).toBe(false)
  })

  it("#given omitted mode and --mode json on argv #then it is print mode", () => {
    expect(inferPrintMode(undefined, ["node", "senpi", "--mode", "json", "-p", "hi"])).toBe(true)
    expect(inferPrintMode(undefined, ["node", "senpi", "--mode=json"])).toBe(true)
  })

  it("#given omitted mode and no json flag #then it is not print mode", () => {
    expect(inferPrintMode(undefined, ["node", "senpi"])).toBe(false)
  })
})
