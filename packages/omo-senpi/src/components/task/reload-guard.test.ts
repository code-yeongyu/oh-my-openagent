import { describe, expect, it } from "bun:test"

import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  evaluateReloadVeto,
  wireReloadGuard,
  type ReloadGuardDagSource,
  type ReloadGuardManager,
} from "./reload-guard"

function record(overrides: Partial<TaskRecord> & Pick<TaskRecord, "task_id" | "status">): TaskRecord {
  return {
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "faux/faux-1",
    residency_state: "resident",
    created_at: "2026-07-28T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z",
    notification: { run_epoch: 1, notified_epoch: 0 },
    notify_on_terminal: false,
    ...overrides,
  }
}

function managerOf(records: readonly TaskRecord[]): ReloadGuardManager {
  return {
    residentTaskIds: () => records.map((entry) => entry.task_id),
    get: (taskId) => records.find((entry) => entry.task_id === taskId),
  }
}

function dagSource(runs: ReadonlyArray<{ readonly runId: string; readonly name: string; readonly status: string }>): ReloadGuardDagSource {
  return { liveRuns: () => runs.filter((entry) => !["completed", "failed", "cancelled"].includes(entry.status)) }
}

describe("reload guard", () => {
  it("#given a running resident child #when the veto is evaluated #then reload is cancelled with an actionable reason", () => {
    const veto = evaluateReloadVeto(managerOf([record({ task_id: "st_1", status: "running", name: "explore-auth" })]))

    expect(veto).toEqual({
      cancel: true,
      reason:
        "1 subagent(s) still running: explore-auth - wait for them to finish or cancel them (task_cancel) before reloading.",
    })
  })

  it("#given running children #when labelled #then description wins over name over task id", () => {
    const veto = evaluateReloadVeto(
      managerOf([
        record({ task_id: "st_1", status: "running", name: "worker", description: "Fix type error" }),
        record({ task_id: "st_2", status: "running", name: "momus-review" }),
        record({ task_id: "st_3", status: "running" }),
      ]),
    )

    expect(veto?.reason).toBe(
      "3 subagent(s) still running: Fix type error, momus-review, st_3 - wait for them to finish or cancel them (task_cancel) before reloading.",
    )
  })

  it("#given only terminal residents #when the veto is evaluated #then reload is not blocked", () => {
    const veto = evaluateReloadVeto(
      managerOf([
        record({ task_id: "st_1", status: "completed" }),
        record({ task_id: "st_2", status: "cancelled" }),
        record({ task_id: "st_3", status: "error" }),
      ]),
    )

    expect(veto).toBeUndefined()
  })

  it("#given no resident children #when the veto is evaluated #then reload is not blocked", () => {
    expect(evaluateReloadVeto(managerOf([]))).toBeUndefined()
  })

  it("#given a wired guard #when senpi emits session_before_reload #then the handler returns the cancel result", async () => {
    const pi = new FakeExtensionAPI()
    wireReloadGuard(pi, managerOf([record({ task_id: "st_9", status: "running", name: "deep-refactor" })]))

    expect(pi.handlers.map((entry) => entry.event)).toEqual(["session_before_reload"])
    const results = await pi.dispatch("session_before_reload", { type: "session_before_reload" })
    expect(results).toEqual([
      {
        cancel: true,
        reason:
          "1 subagent(s) still running: deep-refactor - wait for them to finish or cancel them (task_cancel) before reloading.",
      },
    ])
  })

  it("#given a running child #when the veto is consulted twice (senpi pre-check + internal check) #then both consultations return the identical result", async () => {
    const pi = new FakeExtensionAPI()
    wireReloadGuard(pi, managerOf([record({ task_id: "st_7", status: "running", name: "deep-refactor" })]))

    const first = await pi.dispatch("session_before_reload", { type: "session_before_reload" })
    const second = await pi.dispatch("session_before_reload", { type: "session_before_reload" })
    expect(second).toEqual(first)
    expect(first[0]).toHaveProperty("cancel", true)
  })

  it("#given a wired guard with no running children #when senpi emits session_before_reload #then reload proceeds", async () => {
    const pi = new FakeExtensionAPI()
    wireReloadGuard(pi, managerOf([record({ task_id: "st_1", status: "completed" })]))

    const results = await pi.dispatch("session_before_reload", { type: "session_before_reload" })
    expect(results).toEqual([undefined])
  })

  it("#given a live dag run and no running children #when the veto is evaluated #then reload is cancelled naming the run", () => {
    const veto = evaluateReloadVeto(
      managerOf([]),
      dagSource([{ runId: "dag_1", name: "mass-ulw", status: "running" }]),
    )

    expect(veto).toEqual({
      cancel: true,
      reason:
        "1 DAG run(s) still in flight: mass-ulw - wait for them to finish or cancel them (dag cancel) before reloading.",
    })
  })

  it("#given only terminal dag runs #when the veto is evaluated #then reload is not blocked", () => {
    const veto = evaluateReloadVeto(
      managerOf([]),
      dagSource([
        { runId: "dag_1", name: "done", status: "completed" },
        { runId: "dag_2", name: "broke", status: "failed" },
        { runId: "dag_3", name: "stopped", status: "cancelled" },
      ]),
    )

    expect(veto).toBeUndefined()
  })

  it("#given both a running child and a live dag run #when the veto is evaluated #then the reason names both", () => {
    const veto = evaluateReloadVeto(
      managerOf([record({ task_id: "st_1", status: "running", name: "explore-auth" })]),
      dagSource([{ runId: "dag_1", name: "mass-ulw", status: "pending" }]),
    )

    expect(veto?.reason).toBe(
      "1 subagent(s) still running: explore-auth - wait for them to finish or cancel them (task_cancel) before reloading."
      + " 1 DAG run(s) still in flight: mass-ulw - wait for them to finish or cancel them (dag cancel) before reloading.",
    )
  })

  it("#given a wired guard with a live dag run #when senpi emits session_before_reload #then the handler cancels the reload", async () => {
    const pi = new FakeExtensionAPI()
    wireReloadGuard(pi, managerOf([]), dagSource([{ runId: "dag_9", name: "release", status: "running" }]))

    const results = await pi.dispatch("session_before_reload", { type: "session_before_reload" })
    expect(results[0]).toHaveProperty("cancel", true)
  })
})
