import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskRecordStore } from "../src/store"
import { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT } from "../src/manager/transcript-log"
import { createTaskOutputTool } from "../src/tools/output"
import type { ListScope, ListedTask, OutputManager } from "../src/index"
import type { TaskRecord } from "../src/state"

function ctx(sessionId: string) {
  return { sessionManager: { getSessionId: () => sessionId } } as never
}

function managerFrom(records: readonly TaskRecord[]): OutputManager {
  return {
    get: (taskId) => records.find((record) => record.task_id === taskId),
    list(scope: ListScope): readonly ListedTask[] {
      const filtered = scope.scope === "all" ? records : records.filter((r) => r.parent_session_id === scope.session_id)
      return filtered.map((record) => ({ record }))
    },
    async waitFor(taskId) {
      const found = records.find((record) => record.task_id === taskId)
      if (found === undefined) throw new Error(`missing task ${taskId}`)
      return found
    },
  }
}

function record(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    task_id: "st_00000001",
    parent_session_id: "session-live",
    root_session_id: "session-live",
    depth: 0,
    status: "completed",
    residency_state: "resident",
    execution_mode: "in-process",
    model: "claude-sonnet-4-5",
    created_at: "2024-12-03T14:00:00.000Z",
    updated_at: "2024-12-03T14:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    ...overrides,
  }
}

async function main(): Promise<void> {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-output-qa-"))
  const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })

  const done = record({ task_id: "st_0000abcd", name: "explorer", status: "completed", final_response: "wrote the report" })
  store.appendEvent(done.task_id, { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "reading the codebase" } })
  store.appendEvent(done.task_id, { type: TRANSCRIPT_TOOL_EVENT, payload: { tool: "grep", is_error: false } })
  store.appendEvent(done.task_id, { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "final: the report is written" } })

  const lost = record({ task_id: "st_0000dead", name: "ghost", status: "lost", pid: 4242 })

  const waitConfig = { min_ms: 5000, default_ms: 60000, max_ms: 600000 } as const
  const output = createTaskOutputTool({ manager: managerFrom([done, lost]), stateDir, waitConfig })

  const happy = await output.execute("call", { task_id: "st_0000abcd", mode: "tail" }, new AbortController().signal, undefined, ctx("session-live"))
  const lostView = await output.execute("call", { name: "ghost", mode: "tail" }, new AbortController().signal, undefined, ctx("session-live"))
  const crossSession = await output.execute("call", { task_id: "st_0000abcd" }, new AbortController().signal, undefined, ctx("session-intruder"))

  console.log("\n=== HAPPY: task_output tail on completed 'explorer' ===")
  console.log(happy.content[0]?.type === "text" ? happy.content[0].text : "")
  console.log("details.kind:", happy.details.kind, "| source:", happy.details.kind === "transcript" ? happy.details.source : "-")
  console.log("\n=== LOST: task_output tail on lost 'ghost' (no throw) ===")
  console.log("details.kind:", lostView.details.kind)
  console.log(JSON.stringify(lostView.details.kind === "status" ? lostView.details.snapshot.lost : lostView.details, null, 2))
  console.log("\n=== FAIL-CLOSED: intruder session reading another session's task ===")
  console.log("details.kind:", crossSession.details.kind)
  console.log("stateDir:", stateDir)
}

void main()
