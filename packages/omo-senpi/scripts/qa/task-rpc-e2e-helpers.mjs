// Lane-private pure helpers for task-rpc-e2e.mjs (todo 27). Extracted so the driver stays under the
// repo's pure-LOC ceiling; every function here is side-effect-free analysis or a read-only probe of the
// sandbox state / real agent dir, unit-covered by the driver's --self-test.
import { spawnSync } from "node:child_process"
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

export function childSessionJsonlExists(stateDir, taskId) {
  const dir = join(stateDir, "sessions", taskId)
  if (!existsSync(dir)) return false
  const walk = (root) =>
    readdirSync(root, { withFileTypes: true }).some((e) => (e.isDirectory() ? walk(join(root, e.name)) : e.name.endsWith(".jsonl")))
  return walk(dir)
}

// The forward-correct spawn assertion: a real rpc-process child is proven ONLY when the record carries
// execution_mode "process" AND a numeric pid AND a child session JSONL under sessions/<id>/ AND an rpc
// detachment residency. Anything less (in-process fallback) is the product gap, not a pass.
export function analyzeSpawn(records, stateDir) {
  const record = records.find((r) => r.execution_mode === "process") ?? records[0]
  if (record === undefined) return { pass: false, reason: "no task record persisted", facts: {} }
  const pid = typeof record.pid === "number" ? record.pid : undefined
  const sessionJsonl = childSessionJsonlExists(stateDir, record.task_id)
  const rpcDetached = record.residency_state === "rpc_detached"
  const pass = record.execution_mode === "process" && pid !== undefined && sessionJsonl && rpcDetached
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

export function scanRpcChildPids() {
  const out = spawnSync("pgrep", ["-f", "senpi --mode rpc"], { encoding: "utf8" })
  if (typeof out.stdout !== "string") return []
  return out.stdout.split(/\s+/).filter((s) => s.length > 0).map((s) => Number.parseInt(s, 10)).filter((n) => Number.isInteger(n))
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
