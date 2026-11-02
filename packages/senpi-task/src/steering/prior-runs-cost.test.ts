import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskLifecycle } from "../lifecycle/create"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import type { TaskRecord, TaskRunStats } from "../state"
import { createTaskRecordStore } from "../store"
import { parseTaskRecord } from "../store/record-parse"
import { buildRevived } from "./engine-policy"

afterEach(cleanupProjects)

const HOST_PID = 6100
const NOW = "2026-10-20T00:00:00.000Z"

function withRunStats(store: ReturnType<typeof tempStore>, input: Parameters<typeof seedRecord>[1], runStats: TaskRunStats): TaskRecord {
  const record: TaskRecord = { ...seedRecord(store, input), run_stats: runStats }
  store.replace(record)
  return record
}

function stats(cost: number | undefined, status: TaskRunStats["cost_status"]): TaskRunStats {
  return { runtime_ms: 1, turns: 1, tool_calls: 0, cost_status: status, ...(cost === undefined ? {} : { cost_usd: cost }) }
}

describe("a task's earlier runs keep their spend across revives (senpi#2471)", () => {
  test("#given a finished run that reported cost #when it is revived twice #then each finished run's cost is folded in once", () => {
    // given
    const store = tempStore()
    const first = withRunStats(store, { task_id: "st_00024710", status: "completed" }, stats(0.25, "reported"))

    // when
    const revived = buildRevived(first, NOW)
    const finishedAgain: TaskRecord = { ...revived, status: "completed", run_stats: stats(0.5, "reported") }
    const revivedAgain = buildRevived(finishedAgain, NOW)

    // then
    expect(revived.run_stats).toBeUndefined()
    expect(revived.prior_runs_cost_usd).toBeCloseTo(0.25, 10)
    expect(revivedAgain.prior_runs_cost_usd).toBeCloseTo(0.75, 10)
  })

  test("#given a finished run whose cost was never reported #when it is revived #then nothing is folded in", () => {
    // given
    const store = tempStore()
    const unreported = withRunStats(store, { task_id: "st_00024711", status: "completed" }, stats(undefined, "unavailable"))

    // when
    const revived = buildRevived(unreported, NOW)

    // then
    expect(revived.prior_runs_cost_usd).toBeUndefined()
  })

  test("#given a finished run whose cost is only a lower bound (partial) #when it is revived #then that lower bound is folded in, as the live footer counts it", () => {
    // given
    const store = tempStore()
    const partial = withRunStats(store, { task_id: "st_00024714", status: "completed" }, stats(0.4, "partial"))

    // when
    const revived = buildRevived(partial, NOW)

    // then
    expect(revived.prior_runs_cost_usd).toBeCloseTo(0.4, 10)
  })

  test("#given a finished run whose cost is invalid #when it is revived #then nothing is folded in", () => {
    // given
    const store = tempStore()
    const invalid = withRunStats(store, { task_id: "st_00024715", status: "completed" }, stats(0.4, "invalid"))

    // when
    const revived = buildRevived(invalid, NOW)

    // then
    expect(revived.prior_runs_cost_usd).toBeUndefined()
  })

  test("#given a revive that is rolled back #when the prior run is restored #then its cost is not counted twice", () => {
    // given
    const store = tempStore()
    const prior = withRunStats(store, {
      task_id: "st_00024712",
      status: "completed",
      residency_state: "rpc_detached",
      execution_mode: "process",
    }, stats(0.25, "reported"))
    store.replace({ ...buildRevived(prior, new Date().toISOString()), host_pid: HOST_PID })
    const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry: new FakeRegistry(), config: settings(), hostPid: HOST_PID })

    // when
    expect(lifecycle.rollbackDetachedRevival(prior)).toBe("rolled_back")
    lifecycle.dispose?.()

    // then
    const restored = store.load(prior.task_id)
    expect(restored?.run_stats?.cost_usd).toBeCloseTo(0.25, 10)
    expect(restored?.prior_runs_cost_usd).toBeUndefined()
  })

  test("#given a revived record on disk #when another host reloads it #then the earlier runs' spend survives", () => {
    // given
    const store = tempStore()
    const prior = withRunStats(store, { task_id: "st_00024713", status: "completed" }, stats(0.25, "reported"))
    store.replace(buildRevived(prior, NOW))

    // when
    const reloaded = createTaskRecordStore({ project_dir: "/unused", task: { state_dir: store.stateDir } }).load(prior.task_id)

    // then
    expect(reloaded?.prior_runs_cost_usd).toBeCloseTo(0.25, 10)
  })

  test("#given a record with a negative earlier-runs spend #when parsed #then it is rejected as malformed", () => {
    // given
    const store = tempStore()
    const record = seedRecord(store, { task_id: "st_00024714", status: "completed" })

    // when / then
    expect(() => parseTaskRecord({ ...record, prior_runs_cost_usd: -1 }, "test.json")).toThrow("prior_runs_cost_usd")
  })
})
