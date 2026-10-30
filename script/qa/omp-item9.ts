import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { execFileSync } from "node:child_process"
import { realColdRevive } from "../../packages/senpi-task/src/lifecycle/__fixtures__/real-cold-revive"
import { coldReviveHarness } from "../../packages/senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { cleanupProjects } from "../../packages/senpi-task/src/manager/__fixtures__/manager-fakes"
import { idleReplacementCycles } from "../../packages/senpi-task/src/lifecycle/__fixtures__/idle-replacement-cycles"
import { acknowledgedResidentContinuation, generationAcrossContinuations } from "../../packages/senpi-task/src/lifecycle/__fixtures__/resident-continuation"
import { OmoTaskSettingsSchema, OmoTaskSettingsLayerSchema } from "@oh-my-opencode/omo-config-core"

const args = process.argv.slice(2)
const scenario = args[args.indexOf("--case") + 1]
const out = args[args.indexOf("--out") + 1]
assert(out && args.includes("--out"), "--out required")
const startedAt = new Date().toISOString()
const sha = process.env.OMP_SOURCE_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
mkdirSync(dirname(out), { recursive: true })
try {
  const results = await runScenario()
  writeFileSync(out, JSON.stringify({ case: scenario, sha, startedAt, endedAt: new Date().toISOString(), passed: true, results, cleanup: "execution-owned fixtures removed" }, null, 2))
} catch (error) {
  writeFileSync(out, JSON.stringify({ case: scenario, sha, startedAt, endedAt: new Date().toISOString(), passed: false, error: error instanceof Error ? error.stack : String(error) }, null, 2))
  throw error
} finally { cleanupProjects() }

async function runScenario() {
  switch (scenario) {
    case "park-send-resume": return [await realColdRevive("in-process"), await realColdRevive("process")]
    case "revive-refusals": return refusals()
    case "configured-ttl-team": return [await realColdRevive("in-process", false, { idleTimeoutMs: 37 }), await realColdRevive("process", false, { idleTimeoutMs: 37, team: true }), await idleReplacementCycles()]
    case "pending-steering-pressure": return [await pendingPressure(), ...await refusals()]
    default: return assert.fail("unknown --case")
  }
}

async function pendingPressure() {
  const invalids = [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "37", "unlimited", null]
  for (const value of invalids) {
    assert.equal(OmoTaskSettingsSchema.safeParse({ resident_idle_timeout_ms: value }).success, false)
    assert.equal(OmoTaskSettingsLayerSchema.safeParse({ resident_idle_timeout_ms: value }).success, false)
  }
  let now = 1000
  const h = coldReviveHarness({ idleTimeoutMs: 37, now: () => now })
  try {
    assert.equal((await h.send()).kind, "revived")
    const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
    h.fake.settle({ status: "completed", finalResponse: "DONE" })
    await terminal
    const pending = [{ id: "p1", message: "PENDING", deliver_as: "steer" as const }]
    h.store.mutate(h.record.task_id, (record) => ({ ...record, pending_steering: pending }))
    now += 37
    assert.equal(h.registry.hasPendingSends(h.record.task_id), true)
    assert.deepEqual(await h.lifecycle.reclaimIdleResidents?.(), [])
    assert.deepEqual(h.store.load(h.record.task_id)?.pending_steering, pending)
    assert(h.manager.getResidentHandle(h.record.task_id))
    return { invalidDurationsRejected: invalids.length, pendingSteeringPreserved: true, residentRetained: true }
  } finally { await h.dispose() }
}

async function refusals() {
  const results: unknown[] = []
  for (const policy of ["recorded_warn", "recorded_silent", "refuse"] as const) {
    for (const generation of [undefined, 1, 2]) {
      const h = coldReviveHarness({ policy, ...(generation === undefined ? {} : { generation }) })
      try {
        const result = await h.send()
        assert.equal(result.kind, policy === "refuse" && generation === 1 ? "config_generation_mismatch" : "revived")
        assert.equal(h.warnings.length, policy === "recorded_warn" && generation === 1 ? 1 : 0)
        results.push({ policy, generation: generation ?? "unknown", result, warnings: h.warnings })
      } finally { await h.dispose() }
    }
  }
  for (const reason of ["cwd", "transcript", "killed", "foreign", "residency"] as const) {
    const h = coldReviveHarness({ cap: 1 })
    try {
      if (reason === "cwd") h.store.mutate(h.record.task_id, (record) => ({ ...record, spawn_spec: { version: 1, cwd: join(h.project, "missing"), prompt: "fixture" } }))
      if (reason === "transcript") rmSync(h.sessionPath)
      if (reason === "killed") h.store.mutate(h.record.task_id, (record) => ({ ...record, killed: true }))
      if (reason === "foreign") h.store.mutate(h.record.task_id, (record) => ({ ...record, host_pid: process.pid + 1 }))
      if (reason === "residency") h.store.save({ ...h.record, task_id: "st_00000903", status: "running", residency_state: "resident" })
      const result = await h.send()
      assert.notEqual(result.kind, "revived")
      assert.equal(h.resumed.length, 0)
      results.push({ reason, result })
    } finally { await h.dispose() }
  }
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const race = coldReviveHarness({ resume: async (_spec, _path, handle) => { entered.resolve(); await release.promise; return handle } })
  const first = race.send()
  try {
    await Promise.race([entered.promise, first.then((result) => assert.fail(`early result: ${result.kind}`))])
    const second = await race.send("SECOND")
    assert.equal(second.kind, "admission_refused")
    assert.deepEqual(await race.lifecycle.reclaimIdleResidents?.(), [])
    assert.equal(race.resumed.length, 1)
    results.push({ race: "two sends vs reaper", second, spawns: race.resumed.length })
  } finally { release.resolve() }
  try { assert.equal((await first).kind, "revived") } finally { await race.dispose() }
  const lane = coldReviveHarness()
  try {
    const holder = await lane.manager.start({ prompt: "hold", parent_session_id: "parent", depth: 1 })
    assert.equal(holder.kind, "started")
    const result = await lane.send()
    assert.deepEqual(result, { kind: "admission_refused", task_id: lane.record.task_id, reason: "lane_capacity" })
    results.push({ lane: result })
    if (holder.kind === "started") await lane.manager.cancelTask(holder.task_id)
  } finally { await lane.dispose() }
  let attempts = 0
  const uncertain = coldReviveHarness({ resume: async (_spec, _path, handle) => ({ ...handle, hasExited: () => true, followUp: async () => { attempts += 1; throw new Error("fixture ack loss") } }) })
  try {
    const initial = await uncertain.send()
    const repeated = await uncertain.send()
    assert.equal(initial.kind, "delivery_uncertain")
    assert.equal(repeated.kind, "delivery_uncertain")
    assert.equal(attempts, 1)
    results.push({ initial, repeated, attempts })
  } finally { await uncertain.dispose() }
  let acknowledged = false
  const ackFailure = coldReviveHarness({
    resume: async (_spec, _path, handle) => ({ ...handle, followUp: async (message) => { await handle.followUp(message); acknowledged = true } }),
    storeWrapper: (store) => ({ ...store, mutate: (id, update) => store.mutate(id, (record) => {
      const next = update(record)
      if (acknowledged && next.pending_steering?.length === 0) throw new Error("fixture ack persistence failure")
      return next
    }) }),
  })
  try {
    ackFailure.store.mutate(ackFailure.record.task_id, (record) => ({ ...record, pending_steering: [{ id: "p1", message: "PENDING", deliver_as: "steer" }] }))
    const initial = await ackFailure.send()
    const repeated = await ackFailure.send()
    assert.equal(initial.kind, "delivery_uncertain")
    assert.equal(repeated.kind, "delivery_uncertain")
    assert.equal(ackFailure.fake.followUpCalls.length, 1)
    results.push({ case: "acknowledged batch with failed bookkeeping", initial, repeated, attempts: ackFailure.fake.followUpCalls.length })
  } finally { acknowledged = false; await ackFailure.dispose() }
  for (const status of ["completed", "interrupted", "error"] as const) results.push(await acknowledgedResidentContinuation(status))
  for (const generation of [undefined, 1]) results.push(await generationAcrossContinuations(generation))
  results.push(await realColdRevive("in-process", true))
  return results
}
