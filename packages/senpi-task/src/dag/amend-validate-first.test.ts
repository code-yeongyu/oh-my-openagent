import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

// Delta review 2 of #15135, finding 5: amend drained a settled run's owed stop before it validated
// the amendment, so a malformed or invalid amendment, rejected anyway, still cancelled the child.
test("#11381 #given a settled run that owes a stop for a reachable child #when malformed or invalid amendments are submitted #then each is rejected and the child is left untouched", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-amend-validate-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const key = "amend-validate"
  const started = await fixture.start(definition(key, [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  await runner.selfResume("A")
  runner.settle("B", completed("B"))
  await fixture.wait(runId)
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (taskA === undefined) throw new Error("node A owns no task")
  expect(fixture.manager.snapshot(runId, parentSessionId).outstandingStop).toEqual({ liveTaskIds: [taskA] })
  const valid = definition(key, [categoryNode("A", [], { prompt: "do A-fixed" }), categoryNode("B")])
  const codeOf = (amending: Promise<unknown>) =>
    amending.then(
      () => "applied",
      (error: { readonly code?: string }) => error.code,
    )

  // when
  const answers = [
    await codeOf(fixture.manager.amend({ runId, key, definition: valid, parentSessionId })),
    await codeOf(
      fixture.manager.amend({ runId, definition: definition(key, [categoryNode("A", ["ghost"])]), parentSessionId }),
    ),
    await codeOf(
      fixture.manager.amend({ runId, definition: definition("another-key", [categoryNode("A")]), parentSessionId }),
    ),
  ]

  // then
  expect(answers).toEqual(["invalid_arguments", expect.stringMatching(/^invalid_/), "invalid_amendment"])
  expect(fixture.taskStore.load(taskA)?.status).toBe("running")
  expect(runner.child("A").stops.aborted).toBe(0)
})
