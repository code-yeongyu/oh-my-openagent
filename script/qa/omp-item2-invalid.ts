import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../../packages/senpi-task/src/lifecycle"
import type { ResidencyRegistry } from "../../packages/senpi-task/src/lifecycle/port"
import { createTaskManager } from "../../packages/senpi-task/src/manager/manager"
import { TaskConcurrency } from "../../packages/senpi-task/src/manager/concurrency"
import { createTaskRecordStore } from "../../packages/senpi-task/src/store"
import { finalizeReport, recommendDefault, type MeasurementRun } from "../../packages/senpi-task/src/workpool/measurement.ts"

const digest = "31121b6554593f7f2a24d552ffe39825943b94bcfef78efbe63bcf556ba33f55"
const hash = (n: string): string => n.repeat(64)
function run(mode: MeasurementRun["mode"], extra: Partial<MeasurementRun> = {}): MeasurementRun {
  return {
    mode, provider: "xai", model: "grok-4.6", batch_sha256: hash("b"), prompt_sha256: hash("d"),
    caps_sha256: hash("e"), item_order_sha256: hash("f"), scored_items: 12, correct_items: 12,
    total_tokens: 100, cost_usd: 1, p95_ms: 10, peak_residents: 2, complete: true, ...extra,
  }
}
function pair(runs: MeasurementRun[], extra: Record<string, unknown> = {}) {
  return finalizeReport({
    schema_version: 1, plan_sha256: digest, design: "AB/BA", width: 2, batch_sha256: hash("b"),
    source_sha256: hash("c"), item_count: 12, senpi_items: 6, omo_items: 6, token_coverage: true,
    budget_exhausted: false, duplicate_dispatches: 0, uncertain_dispatches: 0, runs, ...extra,
  })
}

export async function runInvalid(out: string) {
  const missing = pair(["fresh", "keep_alive", "keep_alive", "fresh"].map(mode => run(mode as MeasurementRun["mode"])), { token_coverage: false })
  const wrongModel = pair([run("fresh"), run("keep_alive", { model: "other" }), run("keep_alive"), run("fresh")])
  const wrongBatch = pair([run("fresh"), run("keep_alive", { batch_sha256: hash("0") }), run("keep_alive"), run("fresh")])
  const uncertain = pair(["fresh", "keep_alive", "keep_alive", "fresh"].map(mode => run(mode as MeasurementRun["mode"])), { uncertain_dispatches: 1 })
  const ceiling = pair(["fresh", "keep_alive", "keep_alive", "fresh"].map((mode, index) => run(mode as MeasurementRun["mode"], index === 3 ? { complete: false, scored_items: 3, total_tokens: 0, cost_usd: 0 } : {})), { budget_exhausted: true })
  for (const report of [missing, wrongModel, wrongBatch, uncertain, ceiling]) {
    assert.equal(report.status, "inconclusive")
    assert.equal(recommendDefault(report), "fresh")
  }
  const root = mkdtempSync(join(tmpdir(), "omp-item2-invalid-"))
  const store = createTaskRecordStore({ project_dir: root })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const concurrency = new TaskConcurrency(config)
  const starts: unknown[] = []
  const runner = { start: async (spec: { taskId: string }) => {
    starts.push(spec)
    return { task_id: spec.taskId, sessionId: `worker-${spec.taskId}`, pid: undefined, waitForOutcome: () => new Promise<never>(() => {}), followUp: async () => undefined, steer: async () => undefined, abort: async () => undefined, dispose: async () => undefined, subscribe: () => () => undefined, lastAssistantText: () => undefined }
  } }
  const registry: ResidencyRegistry = {
    get: () => undefined, entries: () => [], forget: () => undefined, hasPendingSends: () => false,
    tryClaimEviction: () => false, releaseEviction: () => undefined,
  }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({
    store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }),
    destruction: lifecycle,
    admit: async () => ({ kind: "admitted" }),
  })
  try {
    concurrency.tryAcquire("test/model", "st_00000001", 0)
    const caller = { sessionId: "parent", rootSessionId: "root", depth: 0, cwd: root }
    const pool = manager.workpools.create(caller, { name: "batch", agent: { category: "quick", prompt: "Process input" }, mode: "fresh" })
    const waiting = manager.workpools.waitForEvent(pool.pool_id, "waiting", AbortSignal.timeout(5000))
    const receipt = manager.workpools.push(caller, pool.pool_id, [{ key: "a", input: { n: 1 } }])
    await waiting
    assert.equal(receipt.item_ids.length, 1)
    assert.equal(starts.length, 0)
    const zeroCapacity = pair([run("fresh", { complete: false, scored_items: 0, correct_items: 0, total_tokens: 0, cost_usd: 0, p95_ms: 0, peak_residents: 0 }), run("keep_alive"), run("keep_alive"), run("fresh")])
    assert.equal(zeroCapacity.status, "inconclusive")
    manager.workpools.cancel(caller, pool.pool_id)
    return {
      passed: true, out, status: "FAIL_CLOSED",
      cases: ["missing-usage", "wrong-model", "wrong-batch-hash", "zero-capacity-first-push", "ack-uncertainty", "spend-ceiling"],
      reports: { missing, wrongModel, wrongBatch, uncertain, ceiling, zeroCapacity },
      zeroCapacityPush: { receipt, starts: starts.length, fabricatedCost: false },
    }
  } finally {
    manager.workpools.dispose()
    lifecycle.dispose?.()
    rmSync(root, { recursive: true, force: true })
  }
}
