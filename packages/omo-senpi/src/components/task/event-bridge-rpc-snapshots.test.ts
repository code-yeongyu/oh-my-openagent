import { describe, expect, it } from "bun:test"

import { taskRecord, taskSnapshot , fakeTaskRpcTimers } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge native task RPC snapshots", () => {
  it("#given current and foreign session tasks #when session_start completes #then it emits an initial omo.task.updated snapshot only for the captured parent session", async () => {
    const mine = taskRecord({ task_id: "st_current", status: "running" })
    const foreign = taskRecord({
      task_id: "st_foreign",
      status: "running",
      parent_session_id: "other-session",
      root_session_id: "other-session",
    })
    const { pi } = wireHarness("parent-session", {
      records: { [mine.task_id]: mine, [foreign.task_id]: foreign },
      withRpc: true,
    })

    await pi.dispatch("session_start", {}, {})

    expect(pi.rpcEvents).toEqual([
      {
        name: "omo.task.updated",
        data: {
          parent_session_id: "parent-session",
          tasks: [taskSnapshot(mine)],
        },
      },
    ])
  })

  it("#given an active captured session #when store mutations move its task through pending running and completed #then each lifecycle snapshot emits while foreign-session tasks stay excluded", async () => {
    const foreign = taskRecord({
      task_id: "st_foreign",
      status: "running",
      parent_session_id: "other-session",
      root_session_id: "other-session",
    })
    const harness = wireHarness("parent-session", {
      records: { [foreign.task_id]: foreign },
      withRpc: true,
    })
    await harness.pi.dispatch("session_start", {}, {})
    harness.pi.rpcEvents.length = 0

    const pending = taskRecord({ task_id: "st_lifecycle", status: "pending" })
    harness.records[pending.task_id] = pending
    harness.emitStoreMutation()
    const running = { ...pending, status: "running" as const, updated_at: "2026-08-11T00:00:02.000Z" }
    harness.records[pending.task_id] = running
    harness.emitStoreMutation()
    const completed = { ...running, status: "completed" as const, updated_at: "2026-08-11T00:00:03.000Z" }
    harness.records[pending.task_id] = completed
    harness.emitStoreMutation()

    expect(harness.pi.rpcEvents).toEqual([
      {
        name: "omo.task.updated",
        data: { parent_session_id: "parent-session", tasks: [taskSnapshot(pending)] },
      },
      {
        name: "omo.task.updated",
        data: { parent_session_id: "parent-session", tasks: [taskSnapshot(running)] },
      },
      {
        name: "omo.task.updated",
        data: { parent_session_id: "parent-session", tasks: [taskSnapshot(completed)] },
      },
    ])
    expect(JSON.stringify(harness.pi.rpcEvents)).not.toContain(foreign.task_id)
  })

  it("#given a host without rpc emission #when session start and store mutation run #then task snapshot publication is a graceful no-op", async () => {
    const task = taskRecord({ task_id: "st_optional", status: "running" })
    const harness = wireHarness("parent-session", { records: { [task.task_id]: task } })

    await expect(harness.pi.dispatch("session_start", {}, {})).resolves.toBeDefined()
    harness.emitStoreMutation()

    expect(harness.pi.rpc).toBeUndefined()
    expect(harness.pi.rpcEvents).toEqual([])
  })

  it("#given a running child with live progress and no store change #when the first client reattaches and session_resumed fires #then exactly one identical snapshot is re-emitted and progress keeps counting", async () => {
    const running = taskRecord({ task_id: "st_resumed", status: "running" })
    const clock = fakeTaskRpcTimers()
    const { pi, emitChildEvent } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
      taskRpcTimers: clock.timers,
    })
    await pi.dispatch("session_start", {}, {})
    emitChildEvent(running.task_id, { type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } })
    clock.advance()
    const beforeResume = pi.rpcEvents.at(-1)
    if (beforeResume === undefined) throw new Error("expected a live-progress snapshot before the resume")
    expect(beforeResume).toMatchObject({ data: { tasks: [{ live_progress: { tool_calls: 1 } }] } })
    pi.rpcEvents.length = 0

    await pi.dispatch("session_resumed", { type: "session_resumed" }, {})
    expect(pi.rpcEvents).toEqual([beforeResume])

    emitChildEvent(running.task_id, { type: "tool_execution_start", toolName: "read", args: { path: "b.ts" } })
    clock.advance()
    expect(pi.rpcEvents.at(-1)).toMatchObject({ data: { tasks: [{ live_progress: { tool_calls: 2 } }] } })
  })

  it("#given a session without children #when session_resumed fires #then exactly one empty snapshot is emitted", async () => {
    const { pi } = wireHarness("parent-session", { withRpc: true })
    await pi.dispatch("session_start", {}, {})
    pi.rpcEvents.length = 0

    await pi.dispatch("session_resumed", { type: "session_resumed" }, {})

    expect(pi.rpcEvents).toEqual([
      {
        name: "omo.task.updated",
        data: { parent_session_id: "parent-session", tasks: [] },
      },
    ])
  })

  it("#given an older host with emit but no request registration #when session_start fires #then snapshots still publish without handlers", async () => {
    const running = taskRecord({ task_id: "st_legacy_rpc", status: "running" })
    const { pi, rpcHandlers } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: "emit-only",
    })

    await pi.dispatch("session_start", {}, {})

    expect(pi.rpcEvents).toHaveLength(1)
    expect(pi.rpcEvents[0]).toMatchObject({
      name: "omo.task.updated",
      data: { parent_session_id: "parent-session" },
    })
    expect(rpcHandlers.size).toBe(0)
  })
})
