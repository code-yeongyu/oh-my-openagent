import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  createTaskRecord,
  createTaskRecordStore,
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
  model: "gpt-5.2",
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
if (JSON.stringify(reloaded) !== JSON.stringify(completed)) throw new Error("Reloaded task facts changed")

const eventPath = store.appendEvent(completed.task_id, {
  type: "manual_probe",
  payload: { apiKey: "secret" },
})
const eventLog = readFileSync(eventPath, "utf8")
if (!eventLog.includes('"apiKey":"[REDACTED]"')) throw new Error("Redacted apiKey marker missing")
if (eventLog.includes("secret")) throw new Error("Secret leaked to event log")

const tasksDir = join(resolveStateDir({ project_dir: fixtureRoot }), "tasks")
const corruptPath = join(tasksDir, "st_c0ffee00.json")
writeFileSync(corruptPath, "{not-json", "utf8")
const listed = store.list()
if (listed.records.some((entry) => entry.task_id === "st_c0ffee00")) throw new Error("Corrupt task was loaded")
if (listed.diagnostics[0]?.type !== "parse_error") throw new Error("Corrupt task diagnostic missing")

const rejected = store.transition(completed.task_id, {
  type: "start",
  timestamp: "2026-07-06T02:00:02.000Z",
  pid: 1111,
})
if (rejected.applied) throw new Error("Illegal completed to running transition applied")
if (store.load(completed.task_id)?.status !== "completed") throw new Error("Completed status changed")

const cleanupReceipt = {
  fixtureRoot,
  existedBeforeCleanup: existsSync(fixtureRoot),
}
rmSync(fixtureRoot, { recursive: true, force: true })
const summary = {
  persistedTaskId: completed.task_id,
  stateDir: resolveStateDir({ project_dir: fixtureRoot }),
  eventPath,
  corruptPath,
  reloadIdentical: true,
  redactedApiKey: eventLog.includes('"apiKey":"[REDACTED]"'),
  secretAbsent: !eventLog.includes("secret"),
  corruptSkipped: true,
  corruptDiagnostic: listed.diagnostics[0],
  illegalTransitionApplied: rejected.applied,
  finalStatus: store.load(completed.task_id)?.status ?? completed.status,
  cleanup: {
    ...cleanupReceipt,
    existsAfterCleanup: existsSync(fixtureRoot),
  },
}

console.log(JSON.stringify(summary, null, 2))
