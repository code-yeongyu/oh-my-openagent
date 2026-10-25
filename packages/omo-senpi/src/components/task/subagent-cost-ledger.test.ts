import { describe, expect, it } from "bun:test"

import { LEGACY_RUN_START_EPOCH, type LiveRunStats, type TaskRecord, type TaskRunStats, type TaskStatus } from "@oh-my-opencode/senpi-task"

import { createSubagentCostLedger } from "./subagent-cost-ledger"

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

function cost(usd: number): TaskRunStats {
  return { runtime_ms: 1, turns: 1, tool_calls: 0, cost_usd: usd, cost_status: "reported" }
}

function live(runStartEpoch: number, usd: number): LiveRunStats {
  return { runStartEpoch, stats: cost(usd) }
}

describe("subagent cost ledger: one source per run (senpi#2471)", () => {
  it("#given a run counted live #when its record settles with the same run's stats #then the total neither doubles nor drops", () => {
    // given
    const ledger = createSubagentCostLedger()
    ledger.upsertRecord(record({ task_id: "st_a", status: "running" }))
    ledger.upsertLive("st_a", live(0, 0.3))
    const whileRunning = ledger.total()

    // when
    ledger.upsertRecord(record({ task_id: "st_a", status: "completed", run_stats: cost(0.3) }))
    ledger.upsertLive("st_a", live(0, 0.3))

    // then
    expect(whileRunning).toBeCloseTo(0.3, 10)
    expect(ledger.total()).toBeCloseTo(0.3, 10)
  })

  it("#given a revive that folded the finished run #when the old run's tracker still reports #then it is ignored until the new run's tracker speaks", () => {
    // given: run 0 settled at 0.3, then a revive starts run 1 with run 0 folded into prior_runs_cost_usd
    const ledger = createSubagentCostLedger()
    ledger.upsertRecord(record({ task_id: "st_a", status: "completed", run_stats: cost(0.3) }))
    ledger.upsertRecord(record({ task_id: "st_a", status: "running", prior_runs_cost_usd: 0.3, run_start_epoch: 1, notification: { run_epoch: 1, notified_epoch: 0 } }))

    // when: the stale tracker of run 0 reports, then run 1's tracker reports
    ledger.upsertLive("st_a", live(0, 0.3))
    const withStaleTracker = ledger.total()
    ledger.upsertLive("st_a", live(1, 0.1))

    // then
    expect(withStaleTracker).toBeCloseTo(0.3, 10)
    expect(ledger.total()).toBeCloseTo(0.4, 10)
  })

  it("#given a tracker created ahead of its record's revive #when the record catches up #then the new run counts from the next live report", () => {
    // given: a self-resumed turn's tracker (run 1) speaks while the record still shows run 0 settled
    const ledger = createSubagentCostLedger()
    ledger.upsertRecord(record({ task_id: "st_a", status: "completed", run_stats: cost(0.3) }))
    ledger.upsertLive("st_a", live(1, 0.05))
    const beforeRecord = ledger.total()

    // when
    ledger.upsertRecord(record({ task_id: "st_a", status: "running", prior_runs_cost_usd: 0.3, run_start_epoch: 1, notification: { run_epoch: 1, notified_epoch: 0 } }))
    ledger.upsertLive("st_a", live(1, 0.05))

    // then
    expect(beforeRecord).toBeCloseTo(0.3, 10)
    expect(ledger.total()).toBeCloseTo(0.35, 10)
  })

  it("#given tasks whose cost was unreported, and a removed task #when totalled #then they add nothing", () => {
    // given
    const ledger = createSubagentCostLedger()
    ledger.upsertRecord(record({ task_id: "st_sub", status: "completed", run_stats: { runtime_ms: 1, turns: 3, tool_calls: 2, cost_status: "unavailable" } }))
    ledger.upsertRecord(record({ task_id: "st_gone", status: "completed", run_stats: cost(2) }))

    // when
    ledger.remove("st_gone")

    // then
    expect(ledger.total()).toBe(0)
  })

  it("#given a legacy record without run_start_epoch #when its run_epoch moves mid-run #then its live run keeps counting under one fixed key", () => {
    // given: a pre-field record reattached here; its tracker is tagged with the same fixed legacy key
    const ledger = createSubagentCostLedger()
    const legacy = record({ task_id: "st_old", status: "running" })
    const { run_start_epoch: _dropped, ...withoutRunStart } = legacy
    ledger.upsertRecord(withoutRunStart)
    ledger.upsertLive("st_old", live(LEGACY_RUN_START_EPOCH, 0.2))

    // when: a model fallback moves run_epoch inside the same run
    ledger.upsertRecord({ ...withoutRunStart, notification: { run_epoch: 1, notified_epoch: -1 } })
    ledger.upsertLive("st_old", live(LEGACY_RUN_START_EPOCH, 0.25))

    // then
    expect(ledger.total()).toBeCloseTo(0.25, 10)
  })
})
