import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagRunRecordV1 } from "./manager"
import { createDagScheduler } from "./scheduler"
import type { DagNodeId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"
import { createDagRunReservations } from "./run-reservations"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Delta review of #15135, finding 3: a removed node's child that could not be stopped was ignored and
// the amended work started beside it. Amendment now finishes the run's owed stop first and refuses
// while it cannot; behind it, no node is admitted in a pass after which a superseded or removed-node
// child is still live - the ready nodes fail with the retryable stale_attempt_alive.
async function settledRunWithUnreachableChildOfA() {
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
  return { fixture, runner, runId, orphan }
}

test("#11381 #given a removed node's live child whose stop cannot land #when an amendment adds a ready node #then the amendment is refused and nothing starts until the child is stopped", async () => {
  // given
  const { fixture, runner, runId, orphan } = await settledRunWithUnreachableChildOfA()
  const amended = definition("removed-fence", [categoryNode("B"), categoryNode("C")])

  // when
  const refused = fixture.amend(amended, runId)

  // then
  await expect(refused).rejects.toMatchObject({ code: "run_still_active" })
  expect(runner.startedSpecs.map((spec) => spec.prompt)).toEqual(["do A", "do B"])
  expect(fixture.taskStore.load(orphan)?.status).toBe("running")
  runner.child("A").connection.reconnect()
  const reentry = await fixture.amend(amended, runId)
  await runner.whenStarted(3)
  expect(fixture.taskStore.load(orphan)?.status).toBe("cancelled")
  runner.settle("C", completed("C"))
  expect((await reentry.run).status).toBe("completed")
})

test("#11381 #given an active run whose removed node's child cannot be stopped #when a new node is ready #then the admission fence fails it stale_attempt_alive and it never starts", async () => {
  // given - the run already carries the amendment (A removed, C added) and is admitting again
  const { fixture, runner, runId } = await settledRunWithUnreachableChildOfA()
  const record = fixture.manager.record(runId, parentSessionId)
  const withC = await fixture.manager.start({
    definition: definition("removed-fence-c", [categoryNode("C")]),
    parentSessionId,
    rootSessionId: record.rootSessionId,
  })
  const nodeC = withC.snapshot.nodes[0]
  const definitionC = fixture.manager.record(withC.snapshot.runId, parentSessionId).definition.nodes[0]
  if (nodeC === undefined || definitionC === undefined) throw new Error("no node C")
  const active: DagRunRecordV1 = {
    ...record,
    status: "running",
    definition: {
      ...record.definition,
      nodes: [...record.definition.nodes.filter((node) => node.id === "B"), definitionC],
    },
    nodes: [...record.nodes.filter((node) => node.id === "B"), nodeC],
    waves: [{ index: 0, nodeIds: ["B" as DagNodeId, nodeC.id] }],
    edges: [],
    criticalPath: [],
  }
  fixture.store.writeCheckpoint(runId, active)
  const scheduler = createDagScheduler({
    reservations: createDagRunReservations(),
    store: fixture.store,
    taskManager: fixture.taskManager,
    initialRecord: active,
  })

  // when
  const settled = await Promise.race([
    scheduler.run().then((run) => run.nodes.find((node) => node.id === nodeC.id)),
    runner.whenStarted(3).then(() => "C started beside the live child"),
  ])

  // then
  expect(settled).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
})
