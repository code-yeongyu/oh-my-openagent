import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagRecovery } from "./recovery"
import type { DagNodeId, DagRunId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  type E2eFixture,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review of #15135, finding 4: a cancel that could not stop a child journals the run cancelled,
// and every reader then called it cleanly finished. The obligation is derived, never stored: a run owes
// a stop while it is terminal and still owns a live child. Every surface reads the same derivation, a
// restart reads the same answer, and re-entry is refused until a repeated cancel drains the child.
async function expectOwedStop(fixture: E2eFixture, runId: DagRunId, live: string) {
  expect(fixture.manager.snapshot(runId, parentSessionId).outstandingStop).toEqual({ liveTaskIds: [live] })
  expect((await fixture.wait(runId)).snapshot.outstandingStop).toEqual({ liveTaskIds: [live] })
  expect(() => fixture.retry(runId, ["B" as DagNodeId])).toThrow(live)
}

test("#11381 #given a cancel that could not stop a child #when the run is read, waited, amended or retried, before and after a restart #then each reports the outstanding stop and re-entry waits for the drain", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-owed-stop-"))
  roots.push(root)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const first = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await first.start(definition("owed-stop", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  await first.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  await runner.selfResume("A")
  runner.child("A").connection.lose()
  const live = first.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (live === undefined) throw new Error("node A owns no task")

  // when
  await expect(first.cancel(runId, "stop the run")).rejects.toThrow(live)

  // then - amend drains first and refuses because the child is unreachable; retry refuses outright
  await expectOwedStop(first, runId, live)
  const amended = definition("owed-stop", [categoryNode("A", [], { prompt: "do A-fixed" }), categoryNode("B")])
  await expect(first.amend(amended, runId)).rejects.toMatchObject({ code: "run_still_active" })
  await expectOwedStop(first, runId, live)
  const restarted = createE2eFixture({
    project: root,
    runner: new ControlledRunner(),
    materializeSkills: identityMaterializer,
  })
  await createDagRecovery({ store: restarted.store, taskManager: restarted.taskManager }).resumePausedRuns(
    parentSessionId,
  )
  await expectOwedStop(restarted, runId, live)
  await restarted.cancel(runId, "finish the stop")
  expect(restarted.manager.snapshot(runId, parentSessionId).outstandingStop).toBeUndefined()
  expect(restarted.taskStore.load(live)?.status).toBe("cancelled")
  const retry = restarted.retry(runId, ["B" as DagNodeId])
  await (restarted.runner as ControlledRunner).whenStarted(1)
  ;(restarted.runner as ControlledRunner).settle("B", completed("B"))
  expect((await retry.run).nodes.find((node) => node.id === "B")?.state).toBe("completed")
})
