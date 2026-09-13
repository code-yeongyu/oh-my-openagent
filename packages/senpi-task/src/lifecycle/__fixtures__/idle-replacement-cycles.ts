import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createTaskRecordStore } from "../../store"
import { createTaskManager } from "../../manager/manager"
import { FakeRunner, tempProject, settings } from "../../manager/__fixtures__/manager-fakes"
import { createManagerResidencyRegistry } from "../../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../create"

/** Four active turns share one parent, lane cap and residency cap across four replacement cycles. */
export async function idleReplacementCycles() {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const runner = new FakeRunner()
  const config = settings({ resident_idle_timeout_ms: 37, residency_max_children: 4, default_concurrency: 4, global_concurrency: 4 })
  let now = 1000
  let peakResidents = 0
  const manager = createTaskManager({ store, config, cwd: project, now: () => now,
    planner: () => ({ kind: "resolved", plan: { model: "fixture/model" } }),
    runners: { "in-process": { start: (spec) => runner.start(spec), resume: (spec) => runner.start(spec) }, process: runner },
    admit: async (parent) => {
      const result = await lifecycle.admitResident(parent)
      return result.kind === "rejected" ? { kind: "rejected", message: result.error.message } : result
    },
    destruction: { destroyResidentTask: (id, cause) => lifecycle.destroyResidentTask(id, cause) },
  })
  const registry = createManagerResidencyRegistry(() => manager)
  const lifecycle = createTaskLifecycle({ store, config, registry, now: () => now, idleReclaimerScheduler: { setInterval: () => ({}), clearInterval: () => undefined } })
  const snapshots: unknown[] = []
  const observe = () => {
    const records = store.list().records
    const residents = records.filter((record) => record.residency_state === "resident").length
    peakResidents = Math.max(peakResidents, residents)
    assert(residents <= 4)
    assert.equal(records.filter((record) => record.residency_state === "evicted").length, 0)
  }
  const startFour = async () => {
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const started = await manager.start({ prompt: "fixture", parent_session_id: "parent", depth: 1 })
      assert.equal(started.kind, "started")
      if (started.kind !== "started") assert.fail("replacement refused")
      assert.equal(started.status, "running")
      ids.push(started.task_id)
      const sessionDir = join(store.stateDir, "children", started.task_id, "sessions", started.task_id)
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(join(sessionDir, "fixture.jsonl"), '{"role":"assistant","content":"OLD_OUTPUT_SENTINEL"}\n')
    }
    observe()
    return ids
  }
  const completeFour = async (ids: readonly string[]) => {
    const terminals = ids.map((id) => manager.waitFor(id, { signal: AbortSignal.timeout(5000) }))
    for (const id of ids) {
      const handle = runner.handles.get(id)
      assert(handle)
      handle.settle({ status: "completed", finalResponse: "OLD_OUTPUT_SENTINEL" })
    }
    await Promise.all(terminals)
    observe()
  }
  try {
    const idle = await startFour()
    await completeFour(idle)
    for (let cycle = 0; cycle < 4; cycle += 1) {
      now += config.resident_idle_timeout_ms
      assert.equal((await lifecycle.reclaimIdleResidents?.())?.length, 4)
      const replacements = await startFour()
      await completeFour(replacements)
      now += config.resident_idle_timeout_ms
      assert.deepEqual((await lifecycle.reclaimIdleResidents?.())?.toSorted(), replacements.toSorted())
      // Grant each admission once; all four turns remain active together before settlement.
      for (const id of idle) assert.equal((await manager.sendToTask({ idOrName: id, callerSessionId: "parent", message: `cycle-${cycle}` })).kind, "revived")
      observe()
      await completeFour(idle)
      snapshots.push({ cycle, idle: idle.map((id) => manager.get(id)), replacements: replacements.map((id) => manager.get(id)) })
    }
    return { cycles: 4, concurrentTurns: 4, peakResidents, evicted: 0, nonContinuable: 0, snapshots }
  } finally {
    lifecycle.dispose?.()
    for (const id of manager.residentTaskIds()) await lifecycle.destroyResidentTask(id, "cancel")
  }
}
