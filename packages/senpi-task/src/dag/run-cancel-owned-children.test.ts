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

// Review finding 1 of #15135: run cancel used `abort: "skip"` for every owned child, which defers an
// in-process child's teardown to its outcome, and judged success by rejections alone. A child that
// resumed on its own after its node completed is attached to nothing, so its outcome may never come,
// and a child whose connection is down answers `cancel_pending` while it keeps running.
async function completedNodeWithSelfResumedChild(runner: ControlledRunner, destroyed: string[] = []) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-run-cancel-"))
  roots.push(root)
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    destruction: {
      destroyResidentTask: async (taskId, cause) => {
        destroyed.push(`${taskId}:${cause}`)
      },
    },
  })
  const started = await fixture.start(definition("cancel-detached", [categoryNode("A"), categoryNode("B", ["A"])]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", completed("A"))
  await runner.whenStarted(2)
  const detached = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (detached === undefined) throw new Error("node A owns no task")
  await runner.selfResume("A")
  expect(fixture.taskStore.load(detached)?.status).toBe("running")
  return { fixture, runId, detached }
}

test("#11381 #given a completed node's child that resumed on its own #when the run is cancelled #then that child is aborted and torn down, not left to an outcome that may never come", async () => {
  // given
  const runner = new ControlledRunner()
  const destroyed: string[] = []
  const { fixture, runId, detached } = await completedNodeWithSelfResumedChild(runner, destroyed)

  // when
  await fixture.cancel(runId, "stop the run")

  // then
  expect(fixture.taskStore.load(detached)?.status).toBe("cancelled")
  expect(runner.child("A").stops.aborted).toBe(1)
  expect(destroyed).toContain(`${detached}:cancel`)
})

test("#11381 #given a self-resumed child whose connection is down #when the run is cancelled #then cancel reports the live child and a later cancel finishes the stop once it is reachable", async () => {
  // given
  const runner = new ControlledRunner(undefined, { connectable: true })
  const { fixture, runId, detached } = await completedNodeWithSelfResumedChild(runner)
  runner.child("A").connection.lose()

  // when
  const first = fixture.cancel(runId, "stop the run")

  // then
  await expect(first).rejects.toThrow(detached)
  expect((await fixture.running(runId)).status).toBe("cancelled")
  expect(fixture.taskStore.load(detached)?.status).toBe("running")
  await expect(fixture.cancel(runId, "stop the run")).rejects.toThrow(detached)
  runner.child("A").connection.reconnect()
  await fixture.cancel(runId, "stop the run")
  expect(fixture.taskStore.load(detached)?.status).toBe("cancelled")
})
