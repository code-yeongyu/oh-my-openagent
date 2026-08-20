import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

import { createTaskRecordStore } from "../src/store"
import { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT } from "../src/manager/transcript-log"
import { createTaskOutputTool, type TaskOutputInput } from "../src/tools/output"
import type { ListScope, ListedTask, OutputManager } from "../src/index"
import type { TaskRecord } from "../src/state"

function ctx(sessionId: string) {
  return { sessionManager: { getSessionId: () => sessionId } } as never
}

function managerFrom(readRecords: () => readonly TaskRecord[]): OutputManager {
  return {
    get: (taskId) => readRecords().find((record) => record.task_id === taskId),
    list(scope: ListScope): readonly ListedTask[] {
      const records = readRecords()
      const filtered =
        scope.scope === "all" ? records : records.filter((record) => record.parent_session_id === scope.session_id)
      return filtered.map((record) => ({ record }))
    },
  }
}

function record(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    task_id: "st_00000001",
    parent_session_id: "session-live",
    root_session_id: "session-live",
    depth: 0,
    status: "running",
    residency_state: "resident",
    execution_mode: "in-process",
    model: "claude-sonnet-4-5",
    created_at: "2024-12-03T14:00:00.000Z",
    updated_at: "2024-12-03T14:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

async function runScenario(stateDir: string) {
  const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
  const active = record({ task_id: "st_0000feed", name: "worker" })
  const done = record({
    task_id: "st_0000abcd",
    name: "explorer",
    status: "completed",
    final_response: "wrote the report",
  })
  const lost = record({ task_id: "st_0000dead", name: "ghost", status: "lost", pid: 4242 })
  let records: readonly TaskRecord[] = [active, done, lost]

  store.appendEvent(done.task_id, { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "reading the codebase" } })
  store.appendEvent(done.task_id, { type: TRANSCRIPT_TOOL_EVENT, payload: { tool: "grep", is_error: false } })
  store.appendEvent(done.task_id, { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "final: the report is written" } })

  const output = createTaskOutputTool({ manager: managerFrom(() => records), stateDir })
  const execute = (params: TaskOutputInput, sessionId: string) =>
    output.execute("call", params, new AbortController().signal, undefined, ctx(sessionId))

  const first = await execute({ name: "worker" }, "session-live")
  const unchanged = await execute({ task_id: active.task_id }, "session-live")
  const diagnostic = await execute({ task_id: active.task_id, mode: "tail" }, "session-live")
  const completedTail = await execute({ task_id: done.task_id, mode: "tail" }, "session-live")
  const lostView = await execute({ name: "ghost", mode: "tail" }, "session-live")
  const crossSession = await execute({ task_id: active.task_id }, "session-intruder")

  const completedActive: TaskRecord = {
    ...active,
    status: "completed",
    updated_at: "2024-12-03T14:01:00.000Z",
    final_response: "done",
  }
  records = [completedActive, done, lost]
  const progressed = await execute({ task_id: active.task_id }, "session-live")

  if (first.details.kind !== "status") throw new Error("First status peek did not return a snapshot")
  if (unchanged.details.kind !== "no_progress") throw new Error("Unchanged status replay was not blocked")
  if ("snapshot" in unchanged.details) throw new Error("Unchanged status replay leaked a snapshot")
  if (diagnostic.details.kind !== "transcript") throw new Error("Explicit diagnostic tail was blocked")
  if (completedTail.details.kind !== "transcript" || completedTail.details.source !== "event-log") {
    throw new Error("Completed transcript did not use the event log")
  }
  if (lostView.details.kind !== "status" || lostView.details.snapshot.lost === undefined) {
    throw new Error("Lost task did not return status breadcrumbs")
  }
  if (crossSession.details.kind !== "not_found") throw new Error("Cross-session output did not fail closed")
  if (progressed.details.kind !== "status" || progressed.details.snapshot.final_response !== "done") {
    throw new Error("Changed task state did not re-arm one status snapshot")
  }

  return {
    firstStatus: first.details.kind,
    unchangedStatus: unchanged.details.kind,
    unchangedSnapshotReplayed: "snapshot" in unchanged.details,
    diagnosticMode: diagnostic.details.kind,
    completedTranscriptSource: completedTail.details.source,
    lostRead: lostView.details.kind,
    crossSessionRead: crossSession.details.kind,
    progressedStatus: progressed.details.kind,
    progressedFinalResponse: progressed.details.snapshot.final_response,
  }
}

async function main(): Promise<void> {
  const evidenceDir = process.argv[2]
  if (evidenceDir === undefined) {
    throw new Error("Usage: bun packages/senpi-task/scripts/manual-output-qa.ts <evidence-dir>")
  }

  const fixtureRoot = join(resolve(evidenceDir), "manual-output-fixture")
  rmSync(fixtureRoot, { recursive: true, force: true })
  mkdirSync(fixtureRoot, { recursive: true })
  const summary = await runScenario(fixtureRoot).finally(() => rmSync(fixtureRoot, { recursive: true, force: true }))

  console.log(JSON.stringify({ ...summary, fixtureRemoved: !existsSync(fixtureRoot) }, null, 2))
}

void main()
