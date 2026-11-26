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

// Delta review of #15135, finding 3: a removed node's child that could not be stopped was ignored and
// the next admission started the amended work beside it. No node is admitted in a pass after which a
// superseded or removed-node child is still live; the ready nodes fail with the retryable
// stale_attempt_alive, and node retry recovers once the stop lands.
test("#11381 #given a removed node's live child whose stop cannot land #when the amended run has a new node ready #then that node does not start, and a retry runs it once the child is stopped", async () => {
  // given
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-removed-fence-"))
  roots.push(root)
  const runner = new ControlledRunner(undefined, { connectable: true })
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("removed-fence", [categoryNode("A"), categoryNode("B")]))
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
  const orphan = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (orphan === undefined) throw new Error("node A owns no task")
  runner.child("A").connection.lose()

  // when
  const reentry = await fixture.amend(definition("removed-fence", [categoryNode("B"), categoryNode("C")]), runId)
  const first = await Promise.race([
    reentry.run.then(() => "settled"),
    runner.whenStarted(3).then(() => "C started beside the live child"),
  ])

  // then
  expect(first).toBe("settled")
  const record = await reentry.run
  expect(record.nodes.find((node) => node.id === "C")).toMatchObject({
    state: "failed",
    error: { code: "stale_attempt_alive" },
  })
  expect(fixture.taskStore.load(orphan)?.status).toBe("running")
  runner.child("A").connection.reconnect()
  const retry = fixture.retry(runId, ["C" as DagNodeId])
  await runner.whenStarted(3)
  expect(fixture.taskStore.load(orphan)?.status).toBe("cancelled")
  runner.settle("C", completed("C"))
  expect((await retry.run).status).toBe("completed")
})
