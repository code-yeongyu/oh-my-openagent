import { createInterface } from "node:readline"

import { createTaskId, type TaskRecord } from "../../state"
import { claimTaskRecord } from "../claim"
import { createTaskRecordStore } from "../record-store"

const [projectDir, nowMsRaw, countRaw, tag] = process.argv.slice(2)

if (projectDir === undefined || nowMsRaw === undefined || countRaw === undefined || tag === undefined) {
  process.stderr.write("Expected argv: [projectDir, nowMs, count, tag]\n")
  process.exit(1)
}

const nowMs = Number(nowMsRaw)
const count = Number(countRaw)

if (!Number.isFinite(nowMs) || !Number.isSafeInteger(count) || count < 0) {
  process.stderr.write("nowMs must be finite and count must be a non-negative integer\n")
  process.exit(1)
}

function waitForGo(): Promise<void> {
  const input = createInterface({ input: process.stdin })
  return new Promise((resolve) => {
    input.on("line", (line) => {
      if (line === "GO") {
        input.close()
        resolve()
      }
    })
  })
}

function draftRecord(taskId: string): TaskRecord {
  const timestamp = new Date(nowMs).toISOString()
  return {
    task_id: taskId,
    status: "pending",
    residency_state: "resident",
    parent_session_id: `race-${tag}`,
    root_session_id: `race-${tag}`,
    depth: 1,
    execution_mode: "in-process",
    model: "test/model",
    created_at: timestamp,
    updated_at: timestamp,
    notification: { run_epoch: 0, notified_epoch: -1 },
    name: taskId,
  }
}

try {
  const store = createTaskRecordStore({ project_dir: projectDir })
  process.stdout.write("READY\n")
  await waitForGo()

  const ids: string[] = []
  let retries = 0
  for (let index = 0; index < count; index++) {
    const draft = draftRecord(createTaskId(nowMs))
    const claimed = claimTaskRecord(store, draft, { nameFollowsId: true })
    ids.push(claimed.task_id)
    if (claimed.task_id !== draft.task_id) retries++
  }

  process.stdout.write(`${JSON.stringify({ ids, retries })}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
