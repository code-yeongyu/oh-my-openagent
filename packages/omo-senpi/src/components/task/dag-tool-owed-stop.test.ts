import { afterEach, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, createDagManager, type DagRunId } from "../../../../senpi-task/src/dag"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import type { DagRunStopper } from "../../../../senpi-task/src/dag/outstanding-stop"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import { runRows } from "./dag-status-row-format"
import { runDagTool } from "./dag-tool"

const parentSessionId = "parent-owed-stop"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review 2 of #15135, finding 6: the tool rendered only the terminal status on snapshot and
// attach, and the widget header showed nothing, while the run still owed a stop.
test("#11381 #given a settled run that still owns a live child #when the tool snapshots or attaches it and the widget draws it #then each tells the operator the stop is outstanding", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "omo-dag-owed-stop-"))
  roots.push(root)
  const store = createDagFileStore({ project_dir: root })
  let runId = "" as DagRunId
  const live = { task_id: "task-live", status: "running" } as TaskRecord
  const ownedTasks: DagRunStopper = {
    findOwnedTasks: (scope) =>
      scope.runId === undefined || scope.runId === runId
        ? [{ ...live, owner: { kind: "dag", runId, nodeId: "plan", fingerprint: "f" } } as TaskRecord]
        : [],
    cancelTask: async () => ({
      kind: "cancel_pending",
      task_id: "task-live",
      previous_status: "running",
      reason: "unreachable",
    }),
  }
  const manager = createDagManager({ store, ownedTasks })
  const deps = { manager, parentSessionId: () => parentSessionId, rootSessionId: () => parentSessionId }
  const started = await runDagTool(deps, {
    action: "start",
    definition: { key: "owed-stop", name: "owed stop", nodes: [{ id: "plan", prompt: "plan it", category: "quick" }] },
  })
  if (started.details.kind !== "started") throw new Error("expected the run to start")
  runId = started.details.run_id as DagRunId
  const record = store.readCheckpoint<DagRunRecordV1>(runId)
  if (record === null) throw new Error("no checkpoint")
  store.writeCheckpoint(runId, { ...record, status: "cancelled" })

  // when
  const snapshot = await runDagTool(deps, { action: "snapshot", run_id: runId })
  const attach = await runDagTool(deps, { action: "attach", run_id: runId })
  const header = runRows(manager.snapshot(runId, parentSessionId), undefined)[0]

  // then
  expect(snapshot.content[0]).toMatchObject({ text: expect.stringContaining("cancel the run again") })
  expect(attach.content[0]).toMatchObject({ text: expect.stringContaining("cancel the run again") })
  expect(header).toContain("stop owed")
})
