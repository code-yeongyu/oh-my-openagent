// Pure, senpi-free analysis helpers for task-e2e.mjs (lane-private, named after its driver). Every
// function here is exercised by the driver's --self-test with synthetic fixtures so the assertions are
// verified without the real binary.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// senpi writes ONE machine-global append-only diagnostic log at getAgentDir()/senpi-debug.log
// (senpi config.js getDebugLogPath). Every concurrent senpi process on the host - including sibling QA
// lanes - appends to the REAL ~/.senpi/agent copy, so it is the only real-dir path a correctly isolated
// run may see mutate; the pollution gate exempts exactly this shared log.
export const SHARED_SENPI_LOG = "senpi-debug.log"

// Per-file content snapshot of a directory (relpath -> sha256), for precise pollution attribution.
// Returns an empty map when the directory is absent.
export function snapshotDir(root) {
  const snapshot = new Map()
  if (!existsSync(root)) return snapshot
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) snapshot.set(abs.slice(root.length + 1), createHash("sha256").update(readFileSync(abs)).digest("hex"))
    }
  }
  walk(root)
  return snapshot
}

// Real config/state paths that changed between two snapshots, EXCLUDING the shared diagnostic log.
export function changedRealPaths(before, after) {
  const changed = []
  for (const [rel, sha] of after) if (rel !== SHARED_SENPI_LOG && before.get(rel) !== sha) changed.push(rel)
  for (const rel of before.keys()) if (rel !== SHARED_SENPI_LOG && !after.has(rel)) changed.push(rel)
  return changed
}

// Parse a senpi `--mode json` stdout stream into the array of JSON event objects, ignoring banner lines.
export function parseJsonEvents(stdout) {
  const events = []
  for (const line of String(stdout).split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return events
}

export function findBatchFanout(events, minimumChildren) {
  for (const event of events) {
    if (event?.type !== "tool_execution_end" || event.toolName !== "task") continue
    const items = event.result?.details?.items
    if (Array.isArray(items) && items.length >= minimumChildren) return items
  }
  return []
}

// All distinct st_ task ids that appear anywhere in the event stream.
export function findTaskIds(events) {
  const matches = JSON.stringify(events).match(/st_[A-Za-z0-9]+/g) ?? []
  return [...new Set(matches)]
}

// The idle-wake completion is injected as a NEW turn carrying friendly task-completion rows. Proof for
// the unconditional-wake contract: the notification names the finished task_id, terminal status, and
// task_send continuation hint (messageability = continuable). Returns each fact for precise failure attribution.
export function findWakeNotification(events, taskId) {
  const hay = JSON.stringify(events)
  const hasNotification = hay.includes("task completion") && hay.includes("status:completed")
  const namesTask = typeof taskId === "string" && taskId.length > 0 && hay.includes(taskId)
  const hasContinuationHint = hay.includes("task_send(")
  return {
    hasNotification,
    namesTask,
    hasContinuationHint,
    ok: hasNotification && namesTask && hasContinuationHint,
  }
}

// task_send(deliver_as:"followUp") on a completed-resident child REVIVES it. Proof is the send tool
// result / details reporting kind "revived".
export function findRevived(events) {
  return /"kind"\s*:\s*"revived"|Revived st_/.test(JSON.stringify(events))
}

// task_output(mode:"full") returns the child transcript inline; proof is the transcript text carrying a
// known child response line.
export function findTranscript(events, needle) {
  const hay = JSON.stringify(events)
  return hay.includes("transcript") && hay.includes(needle)
}

// A sync task (run_in_background falsy) returns the child's final text inline in the tool result.
export function findInlineFinal(events, needle) {
  return JSON.stringify(events).includes(needle)
}

// The category-listing error the task tool returns for an unknown category (execute.ts plan_error path).
export function findCategoryListingError(events) {
  return JSON.stringify(events).includes("Available categories:")
}

// Reduce one JSONL store-log line to a compact signature for ordered-subsequence matching.
export function jsonlSignature(entry) {
  if (entry.type === "transition_applied") {
    const payload = entry.payload ?? {}
    return `${payload.status}/${payload.residency_state}`
  }
  return entry.type
}

// Parse the per-task JSONL store log into signatures.
export function jsonlSignatures(jsonlText) {
  const signatures = []
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    signatures.push(jsonlSignature(JSON.parse(line)))
  }
  return signatures
}

// Ordered (not necessarily contiguous) subsequence match: every element of `expected` appears in
// `actual` in order. The store may append dispose/destroy tails we do not pin.
export function matchesOrderedSubsequence(actual, expected) {
  let cursor = 0
  for (const signature of actual) {
    if (cursor < expected.length && signature === expected[cursor]) cursor += 1
  }
  return cursor === expected.length
}

// The expected main-flow transition sequence: spawn->run, first completion, followUp revive, second
// completion. Pinned by the driver against the real store JSONL.
export const MAIN_FLOW_EXPECTED_SEQUENCE = [
  "running/resident",
  "assistant_message",
  "completed/resident",
  "revived",
  "assistant_message",
  "completed/resident",
]
