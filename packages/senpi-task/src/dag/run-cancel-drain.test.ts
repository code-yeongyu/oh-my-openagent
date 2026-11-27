import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isLiveTask } from "./scheduler-context"
import type { DagNodeId } from "./types"
import { categoryNode, createE2eFixture, definition, identityMaterializer } from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review of #15135, finding 1: the stop fan-out snapshotted the live children, awaited, and
// re-read only those ids. A settled child that goes live while a sibling's stop is pending was never
// attempted and the cancel succeeded beside it. The resume fence refuses that reopen; this drives the
// drain itself, for a child the fence cannot refuse (resumeFence: false).
test("#11381 #given a sibling stop held pending during run cancel #when a settled owned child goes live meanwhile #then the cancel stops it too and ends with no live child", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-cancel-drain-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    resumeFence: false,
  })
  const started = await fixture.start(definition("drain", [categoryNode("A"), categoryNode("B"), categoryNode("C")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(3)
  runner.settle("A", completed("A"))
  runner.settle("C", completed("C"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "C" && event.to === "completed",
  )
  await runner.selfResume("C")
  const held = runner.child("C").holdStops()
  const cancel = fixture.cancel(runId, "stop the run")
  await held.reached

  // when
  await runner.selfResume("A")
  held.release()
  await cancel

  // then
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  expect(taskA === undefined ? undefined : fixture.taskStore.load(taskA)?.status).toBe("cancelled")
  expect(fixture.taskManager.findOwnedTasks({ kind: "dag", runId }).filter(isLiveTask)).toEqual([])
})
