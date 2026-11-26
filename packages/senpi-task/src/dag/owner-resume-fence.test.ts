import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isLiveTask } from "./scheduler-context"
import type { DagNodeId, DagRunId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  type E2eFixture,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review of #15135, ruling A: a settled child becomes running again only through the manager's
// self-resume reopen, so the owner is asked there, against the durable run record, in the same step.
function fencedFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-resume-fence-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const torn = new Map<string, () => void>()
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    destruction: {
      destroyResidentTask: async (taskId) => {
        torn.get(taskId)?.()
      },
    },
  })
  // Resolves "refused" when the refusal tore the child down, "reopened" when the record reopened.
  const resume = (name: string, taskId: string) =>
    Promise.race([
      runner.selfResume(name).then(() => "reopened" as const),
      new Promise<"refused">((resolve) => torn.set(taskId, () => resolve("refused"))),
    ])
  return { fixture, runner, resume }
}

function taskOf(fixture: E2eFixture, runId: DagRunId, nodeId: string): string {
  const taskId = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: nodeId as DagNodeId })?.task_id
  if (taskId === undefined) throw new Error(`node ${nodeId} owns no task`)
  return taskId
}

function liveOwned(fixture: E2eFixture, runId: DagRunId): readonly string[] {
  return fixture.taskManager
    .findOwnedTasks({ kind: "dag", runId })
    .filter(isLiveTask)
    .map((task) => task.task_id)
}

test("#11381 #given a current node's finished child #when it resumes on its own while the run's cancel waits on a sibling's stop #then the resume is refused and the cancel ends with no live child", async () => {
  // given
  const { fixture, runner, resume } = fencedFixture()
  const started = await fixture.start(
    definition("fence-cancelling", [categoryNode("A"), categoryNode("B"), categoryNode("C")]),
  )
  const runId = started.snapshot.runId
  await runner.whenStarted(3)
  runner.settle("A", completed("A"))
  runner.settle("C", completed("C"))
  const taskA = taskOf(fixture, runId, "A")
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "C" && event.to === "completed",
  )
  await runner.selfResume("C")
  const held = runner.child("C").holdStops()
  const cancel = fixture.cancel(runId, "stop the run")
  await held.reached

  // when
  const answer = await resume("A", taskA)

  // then
  expect(answer).toBe("refused")
  expect(fixture.taskStore.load(taskA)?.status).toBe("completed")
  held.release()
  await cancel
  expect(liveOwned(fixture, runId)).toEqual([])
})

test("#11381 #given an old attempt's and a removed node's finished children #when each resumes on its own after the amendment #then both are refused and the amended work runs without them", async () => {
  // given
  const { fixture, runner, resume } = fencedFixture()
  const started = await fixture.start(definition("fence-amended", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  runner.settle("B", completed("B"))
  await fixture.wait(runId)
  const [oldA, removedB] = [taskOf(fixture, runId, "A"), taskOf(fixture, runId, "B")]
  const reentry = await fixture.amend(
    definition("fence-amended", [categoryNode("A", [], { prompt: "do A-fixed" }), categoryNode("C")]),
    runId,
  )
  await runner.whenStarted(4)

  // when
  const answers = [await resume("A", oldA), await resume("B", removedB)]

  // then
  expect(answers).toEqual(["refused", "refused"])
  expect([...liveOwned(fixture, runId)].sort()).toEqual(
    [taskOf(fixture, runId, "A"), taskOf(fixture, runId, "C")].sort(),
  )
  runner.settle("A-fixed", completed("A-fixed"))
  runner.settle("C", completed("C"))
  expect((await reentry.run).status).toBe("completed")
  expect(liveOwned(fixture, runId)).toEqual([])
})

test("#11381 #given a settled run #when a finished child it owns resumes on its own #then the resume is refused and the run owes no stop", async () => {
  // given
  const { fixture, runner, resume } = fencedFixture()
  const started = await fixture.start(definition("fence-settled", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", completed("A"))
  expect((await fixture.wait(runId)).status).toBe("completed")
  const taskA = taskOf(fixture, runId, "A")

  // when
  const answer = await resume("A", taskA)

  // then
  expect(answer).toBe("refused")
  expect(fixture.taskStore.load(taskA)?.status).toBe("completed")
  expect((await fixture.wait(runId)).snapshot.outstandingStop).toBeUndefined()
})
