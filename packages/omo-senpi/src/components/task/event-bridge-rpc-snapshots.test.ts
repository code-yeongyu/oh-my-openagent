import { describe, expect, it } from "bun:test"

import { taskRecord, taskSnapshot } from "./event-bridge.test-fixtures"
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
