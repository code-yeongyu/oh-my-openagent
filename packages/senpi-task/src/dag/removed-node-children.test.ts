import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagNodeId } from "./types"
import { categoryNode, createE2eFixture, definition, identityMaterializer } from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Review finding 5 of #15135: the run-wide lookup enumerated only the current definition's nodes. An
// amendment may remove a completed node, whose child stays owned by the run after it resumes on its
// own, invisible to both the re-entry sweep and run cancel.
async function settledRunWithNodeA() {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-removed-node-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("removed-node", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  runner.settle("B", completed("B"))
  await fixture.wait(runId)
  const orphan = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (orphan === undefined) throw new Error("node A owns no task")
  return { fixture, runner, runId, orphan }
}

test("#11381 #given a completed node with a live self-resumed child #when an amendment removes that node #then the child is stopped before the amended run admits work", async () => {
  // given
  const { fixture, runner, runId, orphan } = await settledRunWithNodeA()
  await runner.selfResume("A")

  // when
  const reentry = await fixture.amend(definition("removed-node", [categoryNode("B")]), runId)
  await reentry.run

  // then
  expect(fixture.taskStore.load(orphan)?.status).toBe("cancelled")
})

test("#11381 #given a removed node's child that resumed after the amended run settled #when the run is cancelled #then that child is stopped too", async () => {
  // given
  const { fixture, runner, runId, orphan } = await settledRunWithNodeA()
  const reentry = await fixture.amend(definition("removed-node", [categoryNode("B")]), runId)
  expect((await reentry.run).status).toBe("completed")
  await runner.selfResume("A")
  expect(fixture.taskStore.load(orphan)?.status).toBe("running")

  // when
  await fixture.cancel(runId, "stop the run")

  // then
  expect(fixture.taskStore.load(orphan)?.status).toBe("cancelled")
})
