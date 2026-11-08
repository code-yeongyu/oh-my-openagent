import { describe, expect, it } from "bun:test"

import type { ManagedChildEvent } from "@oh-my-opencode/senpi-task"

import { fakeTaskRpcTimers, taskRecord } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"

function toolStart(toolName: string, path: string): ManagedChildEvent {
  return { type: "tool_execution_start", toolName, args: { path } } as ManagedChildEvent
}

function updatedEvents(rpcEvents: ReadonlyArray<{ name: string; data: unknown }>) {
  return rpcEvents.filter((entry) => entry.name === "omo.task.updated")
}

function currentTool(entry: { data: unknown } | undefined): string | undefined {
  const tasks = (entry?.data as { tasks?: Array<{ live_progress?: { current_tool?: string } }> } | undefined)?.tasks
  return tasks?.[0]?.live_progress?.current_tool
}

describe("task RPC bridge progress coalescing", () => {
  it("#given a burst of distinct progress events in one window #when the coalesce timer fires #then exactly one snapshot emits carrying the last progress state", async () => {
    const running = taskRecord({ task_id: "st_burst", status: "running" })
    const clock = fakeTaskRpcTimers()
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await pi.dispatch("session_start", {}, {})
    pi.rpcEvents.length = 0

    emitChildEvent(running.task_id, toolStart("read", "a.ts"))
    emitChildEvent(running.task_id, toolStart("grep", "b.ts"))
    emitChildEvent(running.task_id, toolStart("edit", "c.ts"))

    // Nothing has reached the socket yet: the burst only marked the snapshot dirty.
    expect(updatedEvents(pi.rpcEvents)).toHaveLength(0)
    expect(clock.pendingCount()).toBe(1)

    clock.advance()

    const emitted = updatedEvents(pi.rpcEvents)
    expect(emitted).toHaveLength(1)
    expect(currentTool(emitted[0])).toContain("edit")
  })

  it("#given progress events straddling two coalesce windows #when each window flushes #then two snapshots emit", async () => {
    const running = taskRecord({ task_id: "st_two_windows", status: "running" })
    const clock = fakeTaskRpcTimers()
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await pi.dispatch("session_start", {}, {})
    pi.rpcEvents.length = 0

    emitChildEvent(running.task_id, toolStart("read", "a.ts"))
    emitChildEvent(running.task_id, toolStart("grep", "b.ts"))
    clock.advance()
    emitChildEvent(running.task_id, toolStart("edit", "c.ts"))
    emitChildEvent(running.task_id, toolStart("bash", "d.ts"))
    clock.advance()

    const emitted = updatedEvents(pi.rpcEvents)
    expect(emitted).toHaveLength(2)
    expect(currentTool(emitted[0])).toContain("grep")
    expect(currentTool(emitted[1])).toContain("bash")
  })

  it("#given a pending coalesced flush #when the session shuts down #then no snapshot emits after teardown", async () => {
    const running = taskRecord({ task_id: "st_dispose_pending", status: "running" })
    const clock = fakeTaskRpcTimers()
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await pi.dispatch("session_start", {}, {})
    emitChildEvent(running.task_id, toolStart("read", "a.ts"))
    pi.rpcEvents.length = 0

    await pi.dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, {})
    clock.advance()

    expect(clock.pendingCount()).toBe(0)
    expect(updatedEvents(pi.rpcEvents)).toHaveLength(0)
  })

  it("#given a queued progress flush #when session_start re-attaches #then the pending timer is cancelled and the attach snapshot emits synchronously", async () => {
    const running = taskRecord({ task_id: "st_attach_order", status: "running" })
    const clock = fakeTaskRpcTimers()
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await pi.dispatch("session_start", {}, {})
    emitChildEvent(running.task_id, toolStart("read", "a.ts"))
    expect(clock.pendingCount()).toBe(1)
    pi.rpcEvents.length = 0

    await pi.dispatch("session_start", {}, {})

    // attach() emits immediately, and the stale progress flush must not fire behind it.
    expect(updatedEvents(pi.rpcEvents)).toHaveLength(1)
    clock.advance()
    expect(updatedEvents(pi.rpcEvents)).toHaveLength(1)
  })

  it("#given a store mutation #when the bridge syncs #then the snapshot still emits synchronously without waiting on the coalesce timer", async () => {
    const running = taskRecord({ task_id: "st_sync_sync", status: "running" })
    const clock = fakeTaskRpcTimers()
    const harness = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await harness.pi.dispatch("session_start", {}, {})
    harness.pi.rpcEvents.length = 0

    harness.records[running.task_id] = {
      ...running,
      status: "completed",
      updated_at: "2026-08-11T00:00:09.000Z",
    }
    harness.emitStoreMutation()

    expect(updatedEvents(harness.pi.rpcEvents)).toHaveLength(1)
  })
})
