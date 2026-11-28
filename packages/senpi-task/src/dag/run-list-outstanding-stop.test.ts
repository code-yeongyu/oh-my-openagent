import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagManager } from "./manager"
import type { DagRunStopper } from "./outstanding-stop"
import type { DagNodeId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review 2 of #15135, finding 6: the run list cached its summary by checkpoint inode, so a debt
// that changes only in the task store never showed. The list carries the same derivation, and a list
// plus every snapshot drawn from it in one batch read the task records once, not once per run.
test("#11381 #given settled runs, one owing a stop #when the session's runs are listed and snapshotted in one batch #then the list names the owed stop and the task records are read once", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-list-owed-"))
  roots.push(root)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const quiet = await fixture.start(definition("list-quiet", [categoryNode("Q")]))
  await runner.whenStarted(1)
  runner.settle("Q", completed("Q"))
  await fixture.wait(quiet.snapshot.runId)
  const owing = await fixture.start(definition("list-owing", [categoryNode("A"), categoryNode("B")]))
  const runId = owing.snapshot.runId
  await runner.whenStarted(3)
  runner.settle("A", completed("A"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  await runner.selfResume("A")
  runner.child("A").connection.lose()
  await expect(fixture.cancel(runId, "stop the run")).rejects.toThrow()
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (taskA === undefined) throw new Error("node A owns no task")
  let reads = 0
  const counted: DagRunStopper = {
    findOwnedTasks: (scope) => {
      reads += 1
      return fixture.taskManager.findOwnedTasks(scope)
    },
    cancelTask: (taskId, reason) => fixture.taskManager.cancelTask(taskId, reason),
  }
  const manager = createDagManager({ store: fixture.store, ownedTasks: counted })

  // when
  const runs = manager.list(parentSessionId)
  const snapshots = runs.map((run) => manager.snapshot(run.runId, parentSessionId))

  // then
  expect(runs.find((run) => run.runId === runId)?.outstandingStop).toEqual({ liveTaskIds: [taskA] })
  expect(runs.find((run) => run.runId === quiet.snapshot.runId)?.outstandingStop).toBeUndefined()
  expect(snapshots.find((snapshot) => snapshot.runId === runId)?.outstandingStop).toEqual({ liveTaskIds: [taskA] })
  expect(reads).toBe(1)
})
