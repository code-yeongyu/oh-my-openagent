import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  createTaskRecord,
  createTaskRecordStore,
  messageability,
  resolveStateDir,
  transitionTaskRecord,
} from "../src/index"

const evidenceDir = process.argv[2]
if (evidenceDir === undefined) throw new Error("Usage: bun packages/senpi-task/scripts/manual-qa.ts <evidence-dir>")

const fixtureRoot = join(evidenceDir, "manual-qa-fixture")
rmSync(fixtureRoot, { recursive: true, force: true })
mkdirSync(fixtureRoot, { recursive: true })

const store = createTaskRecordStore({ project_dir: fixtureRoot })
const record = createTaskRecord({
  name: "Manual QA task",
  parent_session_id: "manual-parent",
  root_session_id: "manual-root",
  depth: 0,
  execution_mode: "direct",
  model: "gpt-5.5",
})
const running = transitionTaskRecord(record, {
  type: "start",
  timestamp: "2026-07-06T02:00:00.000Z",
  pid: 9876,
}).record
const completed = transitionTaskRecord(running, {
  type: "complete",
  timestamp: "2026-07-06T02:00:01.000Z",
  final_response: "manual qa complete",
}).record
store.save(completed)

const reloaded = store.load(completed.task_id)
if (!isDeepStrictEqual(reloaded, completed)) throw new Error("Reloaded task facts changed")

const eventPath = store.appendEvent(completed.task_id, {
  type: "manual_probe",
  payload: { apiKey: "manual-redaction-sentinel" },
})
const eventLog = readFileSync(eventPath, "utf8")
if (!eventLog.includes('"apiKey":"[REDACTED]"')) throw new Error("Redacted apiKey marker missing")
if (eventLog.includes("manual-redaction-sentinel")) throw new Error("Sentinel leaked to event log")

const tasksDir = join(resolveStateDir({ project_dir: fixtureRoot }), "tasks")
const corruptPath = join(tasksDir, "st_c0ffee00.json")
writeFileSync(corruptPath, "{not-json", "utf8")
const malformedPath = join(tasksDir, "st_bad00004.json")
writeFileSync(
  malformedPath,
  JSON.stringify({
    task_id: "st_bad00004",
    status: "pending",
    residency_state: "resident",
    parent_session_id: "manual-parent",
    root_session_id: "manual-root",
    depth: 0,
    execution_mode: "direct",
    model: "gpt-5.5",
    created_at: "2026-07-06T02:00:00.000Z",
    updated_at: "2026-07-06T02:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    pid: "not-a-number",
  }),
  "utf8",
)
const listed = store.list()
if (listed.records.some((entry) => entry.task_id === "st_c0ffee00")) throw new Error("Corrupt task was loaded")
const corruptDiagnostic = listed.diagnostics.find((entry) => entry.path === corruptPath)
if (corruptDiagnostic?.type !== "parse_error") throw new Error("Corrupt task diagnostic missing")
if (listed.records.some((entry) => entry.task_id === "st_bad00004")) throw new Error("Malformed optional task was loaded")
const malformedOptionalDiagnostic = listed.diagnostics.find((entry) => entry.message === "pid is not a number")
if (malformedOptionalDiagnostic === undefined) {
  throw new Error("Malformed optional diagnostic missing")
}

const rejected = store.transition(completed.task_id, {
  type: "start",
  timestamp: "2026-07-06T02:00:02.000Z",
  pid: 1111,
})
if (rejected.applied) throw new Error("Illegal completed to running transition applied")
if (store.load(completed.task_id)?.status !== "completed") throw new Error("Completed status changed")
if (messageability(completed.status, completed.residency_state) !== "revive") {
  throw new Error("Completed resident task was not revivable")
}
const evictedCompleted = transitionTaskRecord(completed, {
  type: "evict",
  timestamp: "2026-07-06T02:00:03.000Z",
})
if (!evictedCompleted.applied) throw new Error("Completed resident eviction was rejected")
if (evictedCompleted.record.status !== "completed") throw new Error("Completed eviction changed lifecycle status")
if (messageability(evictedCompleted.record.status, evictedCompleted.record.residency_state) !== "not-continuable") {
  throw new Error("Evicted completed task remained continuable")
}
const normalLost = transitionTaskRecord(running, {
  type: "lose",
  timestamp: "2026-07-06T02:00:04.000Z",
  error_message: "manual lost should be reconciliation-only",
})
if (normalLost.applied) throw new Error("Normal lost transition applied")
if (normalLost.record.status !== "running") throw new Error("Rejected normal lost transition changed status")

const outsidePath = join(evidenceDir, "manual-outside.jsonl")
let traversalRejected = false
try {
  store.appendEvent("../../../../manual-outside", { type: "manual_probe", payload: {} })
} catch (error) {
  if (!(error instanceof Error)) throw error
  if (!error.message.includes("Invalid task id")) throw error
  traversalRejected = true
}
if (!traversalRejected) throw new Error("Traversal task id was not rejected")
if (existsSync(outsidePath)) throw new Error("Traversal attempt wrote outside state dir")

const cleanupReceipt = {
  fixtureRoot,
  existedBeforeCleanup: existsSync(fixtureRoot),
  outsidePath,
  outsidePathExistsBeforeCleanup: existsSync(outsidePath),
}
rmSync(fixtureRoot, { recursive: true, force: true })
const summary = {
  persistedTaskId: completed.task_id,
  stateDir: resolveStateDir({ project_dir: fixtureRoot }),
  eventPath,
  corruptPath,
  reloadIdentical: true,
  redactedApiKey: eventLog.includes('"apiKey":"[REDACTED]"'),
  sentinelAbsent: !eventLog.includes("manual-redaction-sentinel"),
  corruptSkipped: true,
  malformedOptionalSkipped: true,
  corruptDiagnostic,
  malformedOptionalDiagnostic,
  illegalTransitionApplied: rejected.applied,
  completedResidentMessageability: messageability(completed.status, completed.residency_state),
  evictedCompletedApplied: evictedCompleted.applied,
  evictedCompletedStatus: evictedCompleted.record.status,
  evictedCompletedMessageability: messageability(
    evictedCompleted.record.status,
    evictedCompleted.record.residency_state,
  ),
  normalLostApplied: normalLost.applied,
  normalLostStatus: normalLost.record.status,
  traversalRejected,
  outsideWriteCreated: existsSync(outsidePath),
  finalStatus: store.load(completed.task_id)?.status ?? completed.status,
  cleanup: {
    ...cleanupReceipt,
    existsAfterCleanup: existsSync(fixtureRoot),
  },
}

console.log(JSON.stringify(summary, null, 2))
