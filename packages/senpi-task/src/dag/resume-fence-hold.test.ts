import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isLiveTask } from "./scheduler-context"
import type { DagNodeId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed, failed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// A refused self-resume of a CURRENT claim in a failed run is held, not retired: the unsolicited turn
// is aborted and the child stays exactly as resident and send-revivable as before (node-send keeps
// failed runs sendable). An explicit send must still revive it and fold its outcome as it always did.
async function failedRunThenSendToA(unsolicitedTurn: boolean) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-resume-hold-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("resume-hold", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  runner.settle("B", failed("B"))
  expect((await fixture.wait(runId)).status).toBe("failed")
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (taskA === undefined) throw new Error("node A owns no task")
  const stop = unsolicitedTurn ? runner.child("A").nextStop() : Promise.resolve(undefined)
  if (unsolicitedTurn) void runner.selfResume("A")
  const stopped = await stop
  const afterStop = fixture.taskStore.load(taskA)
  const liveAfterStop = fixture.taskManager.findOwnedTasks({ kind: "dag", runId }).filter(isLiveTask)

  const sent = await fixture.send(runId, "A" as DagNodeId, "one more pass")
  runner.settle("A", completed("A again"))
  if (sent.delivery === "revive") await sent.settled
  const node = fixture.manager.snapshot(runId, parentSessionId).nodes.find((entry) => entry.id === "A")
  return { stopped, afterStop, liveAfterStop, delivery: sent.delivery, nodeState: node?.state }
}

test("#11381 #given a failed run whose completed node's child starts a turn on its own #when the turn is refused and the node is sent a message #then the turn is aborted, the child stays resident and settled, and the send revives it", async () => {
  // given / when
  const held = await failedRunThenSendToA(true)

  // then
  expect(held.delivery).toBe("revive")
  expect(held.stopped).toBe("aborted")
  expect(held.afterStop).toMatchObject({ status: "completed", residency_state: "resident" })
  expect(held.liveAfterStop).toEqual([])
  expect(held.nodeState).toBe("completed")
})

test("#11381 #given the same failed run without an unsolicited turn #when node A is sent a message #then it revives and folds as before", async () => {
  // given / when
  const control = await failedRunThenSendToA(false)

  // then
  expect(control.delivery).toBe("revive")
  expect(control.nodeState).toBe("completed")
})
