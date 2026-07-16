// Lane-private pure helpers for task-rpc-e2e.mjs (todo 27). Extracted so the driver stays under the
// repo's pure-LOC ceiling; every function here is side-effect-free analysis or a read-only probe of the
// sandbox state / real agent dir, unit-covered by the driver's --self-test.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// The isolation guarantee the driver GATES on (Metis #7/#8): the real agent dir's credential/config files
// are never read or rewritten - a child must resolve auth/models from the SANDBOX agent dir. These are
// byte-stable across a run, unlike the whole-dir digest which a live dev machine churns through ambient
// senpi activity (other sessions' JSONL, the global ~/.senpi/agent/senpi-debug.log that ignores
// SENPI_CODING_AGENT_DIR) - exactly why the reference drive.mjs reports realSenpiUntouched without gating.
export const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"]

export function digestCredentialFiles(root) {
  const hash = createHash("sha256")
  for (const name of CREDENTIAL_FILES) {
    const path = join(root, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent")
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function parseEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // non-JSON banner line: ignored by design
    }
  }
  return events
}

export function readRecords(stateDir) {
  const dir = join(stateDir, "tasks")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
}

// The child's rpc session JSONL lands at the product's canonical child session dir, which nests under
// children/<id>/ (senpi-task tools/output/transcript/session-dir.ts childSessionDir), NOT directly at
// sessions/<id>/. The rpc runner's resolveChildSessionDir appends sessions/<id> to the per-child state
// dir (join(stateDir,"children",<id>)), so the full path is children/<id>/sessions/<id>/.
export function childSessionJsonlExists(stateDir, taskId) {
  const dir = join(stateDir, "children", taskId, "sessions", taskId)
  if (!existsSync(dir)) return false
  const walk = (root) =>
    readdirSync(root, { withFileTypes: true }).some((e) => (e.isDirectory() ? walk(join(root, e.name)) : e.name.endsWith(".jsonl")))
  return walk(dir)
}

// Proof of the STEP-1 wiring fix (engine.ts runners.process): a process-mode task must reach the rpc
// runner instead of silently falling back to the in-process runner. The two runners leave different
// store fingerprints - the in-process fallback COMPLETES the task through the mock child (status
// completed), while the rpc runner reaches a real child spawn: either a recorded pid, or (in an
// environment where the rpc child entry cannot be located) a spawn-path failure whose error names the
// rpc child entry. Either fingerprint proves the process slot no longer aliases the in-process runner.
export function analyzeRpcRouting(records) {
  const record = records.find((r) => r.execution_mode === "process") ?? records[0]
  if (record === undefined) return { routed: false, reason: "no task record persisted", facts: {} }
  const hasPid = typeof record.pid === "number"
  const message = typeof record.error_message === "string" ? record.error_message : ""
  const spawnPathFailure = /rpc-entry|--mode rpc|@code-yeongyu\/senpi/i.test(message)
  const routed = record.execution_mode === "process" && (hasPid || spawnPathFailure)
  const reason = routed
    ? undefined
    : `execution_mode=${record.execution_mode} pid=${hasPid} spawnPathFailure=${spawnPathFailure} status=${record.status}`
  return { routed, reason, facts: { task_id: record.task_id, pid: record.pid, status: record.status, error_excerpt: message.slice(0, 160) } }
}

// The forward-correct spawn assertion (plan todo-27 scenario 1): a real rpc-process child is proven when
// the record carries execution_mode "process" AND a numeric pid (a real OS process, which the in-process
// fallback never records) AND a child session JSONL transcript under children/<id>/sessions/<id>/. The
// residency_state is surfaced as an informational fact only: a background child that finished its turn is
// honestly reclaimed to "disposed" by the time the driver reads the record, so gating on the transient
// "rpc_detached" would demand a mid-flight state that cannot survive a completed task. A recorded pid plus
// a real transcript IS the substantive proof that a detached rpc child spawned and ran.
export function analyzeSpawn(records, stateDir) {
  const record = records.find((r) => r.execution_mode === "process") ?? records[0]
  if (record === undefined) return { pass: false, reason: "no task record persisted", facts: {} }
  const pid = typeof record.pid === "number" ? record.pid : undefined
  const sessionJsonl = childSessionJsonlExists(stateDir, record.task_id)
  const pass = record.execution_mode === "process" && pid !== undefined && sessionJsonl
  const reason = pass
    ? undefined
    : `execution_mode=${record.execution_mode} pid=${pid ?? "absent"} sessionJsonl=${sessionJsonl} residency=${record.residency_state}`
  return { pass, reason, facts: { task_id: record.task_id, execution_mode: record.execution_mode, pid, sessionJsonl, residency_state: record.residency_state }, record }
}

export function eventsMentionSteerAck(events) {
  return events.some((e) => JSON.stringify(e).toLowerCase().includes("steer"))
}

export function statusSnapshots(events) {
  const snaps = []
  const scan = (o, d) => {
    if (d > 10 || o === null || typeof o !== "object") return
    if (Array.isArray(o)) return void o.forEach((x) => scan(x, d + 1))
    if (o.kind === "status" && o.snapshot !== null && typeof o.snapshot === "object") snaps.push(o.snapshot)
    for (const v of Object.values(o)) scan(v, d + 1)
  }
  scan(events, 0)
  return snaps
}

export function recordRpcChildPids(records) {
  return records
    .filter((record) => record.execution_mode === "process" && typeof record.pid === "number")
    .map((record) => record.pid)
}

export function liveRecordRpcChildPids(records) {
  return recordRpcChildPids(records).filter(pidAlive)
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Poll the on-disk task records until one matches, or the deadline passes. Used by the kill and
// reconcile scenarios to catch the child WHILE it is still a live, non-terminal process (a hanging
// mock turn keeps status="running" so there is a real pid to signal / reconcile).
export async function pollRecord(stateDir, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = readRecords(stateDir).find(predicate)
    if (match !== undefined) return match
    await sleep(200)
  }
  return undefined
}
