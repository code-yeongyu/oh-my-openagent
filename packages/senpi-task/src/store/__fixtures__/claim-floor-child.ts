import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskId, type TaskRecord } from "../../state"
import { claimTaskRecord } from "../claim"
import { createTaskRecordStore } from "../record-store"

function baseRecord(taskId: string): TaskRecord {
  return {
    task_id: taskId,
    name: taskId,
    status: "pending",
    residency_state: "resident",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 0,
    execution_mode: "in-process",
    model: "test/model",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
  }
}

const project = mkdtempSync(join(tmpdir(), "senpi-task-claim-floor-"))

try {
  const store = createTaskRecordStore({ project_dir: project })
  store.save(baseRecord("st_00000030"))
  const claimed = claimTaskRecord(store, baseRecord("st_00000030"), { nameFollowsId: true })
  assert.equal(claimed.task_id, "st_00000031")
  assert.equal(createTaskId(0x10 * 0x10000), "st_00000032")
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  rmSync(project, { recursive: true, force: true })
}
