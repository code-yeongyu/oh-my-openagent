import { describe, expect, it } from "bun:test"

import type { LiveRunStats, ManagedChildEvent, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "./runtime-context"
import { createTaskStatusUi, type StatusUiManager, type StatusUiTimers } from "./status-ui"

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 1,
    execution_mode: "in-process",
    model: "zai/glm-5.3",
    residency_state: "resident",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:01.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 0, notified_epoch: -1 },
    run_start_epoch: 0,
    ...overrides,
  }
}

const timers: StatusUiTimers = { set: () => 1, clear: () => undefined }

function captureUi(costs: Array<number | undefined>, withCostApi = true): CapturedUi {
  return {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: () => undefined,
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    ...(withCostApi ? { setSubagentCost: (cost: number | undefined) => costs.push(cost) } : {}),
  }
}

describe("createTaskStatusUi subagent tree cost (senpi#2471)", () => {
  it("#given a seeded tree #when children progress and settle through events #then the footer follows each change without rescanning per frame", () => {
    // given: one finished child, one running child owned here
    const store = new Map<string, TaskRecord>([
      ["st_done", record({ task_id: "st_done", status: "completed", run_stats: { runtime_ms: 1, turns: 2, tool_calls: 1, cost_usd: 0.5, cost_status: "reported" } })],
      ["st_live", record({ task_id: "st_live", status: "running" })],
    ])
    let liveUsd = 0.25
    let listCalls = 0
    const listeners: Array<(event: ManagedChildEvent) => void> = []
    const manager: StatusUiManager = {
      list: (scope) => {
        if (scope.scope === "all") listCalls += 1
        return [...store.values()].map((task) => ({ record: task }))
      },
      subscribeChild: (_taskId, listener) => {
        listeners.push(listener)
        return () => undefined
      },
      liveRunStats: (taskId): LiveRunStats | undefined =>
        taskId === "st_live" ? { runStartEpoch: 0, stats: { runtime_ms: 1, turns: 1, tool_calls: 0, cost_usd: liveUsd, cost_status: "reported" } } : undefined,
    }
    const costs: Array<number | undefined> = []
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => captureUi(costs), sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when: seed, repaint frames, a live message_end, then the live child settles at its live figure
    statusUi.syncNow()
    statusUi.syncNow()
    statusUi.syncNow()
    liveUsd = 0.5
    for (const listener of listeners) listener({ type: "message_end", message: { role: "assistant", content: [] } })
    const settled = record({ task_id: "st_live", status: "completed", run_stats: { runtime_ms: 1, turns: 2, tool_calls: 0, cost_usd: 0.5, cost_status: "reported" } })
    store.set("st_live", settled)
    statusUi.observeRecord({ taskId: "st_live", record: settled })

    // then: 0.75 seeded, 1.0 live, still 1.0 after the handover (no double count), and only the seed
    // read the whole tree (an in-process child's settle arrives as a mutation, so it needs no re-read)
    expect(costs).toEqual([0.75, 1])
    expect(listCalls).toBe(1)
  })

  it("#given an engine without setSubagentCost #when synced and mutated #then the tree is never scanned and nothing throws", () => {
    // given
    let listCalls = 0
    const manager: StatusUiManager = { list: (scope) => { if (scope.scope === "all") listCalls += 1; return [] } }
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => captureUi([], false), sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when
    statusUi.syncNow()
    statusUi.observeRecord({ taskId: "st_x", record: record({ task_id: "st_x", status: "running" }) })

    // then
    expect(listCalls).toBe(0)
  })

  it("#given a grandchild recorded under its parent's own session #when the tree is seeded and the grandchild settles later #then both count", () => {
    // given: an in-process child records its children with itself as parent and root (seen in the real nested QA run)
    const child = record({ task_id: "st_child", status: "completed", child_session_id: "child-session", run_stats: { runtime_ms: 1, turns: 2, tool_calls: 1, cost_usd: 0.368, cost_status: "reported" } })
    const grandchild = record({ task_id: "st_grand", status: "running", parent_session_id: "child-session", root_session_id: "child-session" })
    const store = new Map([[child.task_id, child], [grandchild.task_id, grandchild]])
    const manager: StatusUiManager = { list: () => [...store.values()].map((task) => ({ record: task })) }
    const costs: Array<number | undefined> = []
    const statusUi = createTaskStatusUi({ manager, runtime: { ui: () => captureUi(costs), sessionId: () => "session-a", mode: () => "tui" }, timers })

    // when
    statusUi.syncNow()
    const settled: TaskRecord = { ...grandchild, status: "completed", run_stats: { runtime_ms: 1, turns: 1, tool_calls: 0, cost_usd: 0.184, cost_status: "reported" } }
    store.set(settled.task_id, settled)
    statusUi.observeRecord({ taskId: settled.task_id, record: settled })

    // then
    expect(costs.at(-1)).toBeCloseTo(0.552, 10)
  })
})
