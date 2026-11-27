import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DestructionPort } from "../steering"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import type { DagNodeId } from "./types"
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

// Delta review 2 of #15135, finding 2: recovery reconciled only current node ids and could start a
// scheduled node before any scheduler (and its run-wide stale-child fence) existed, beside a live
// child of a node the amendment removed. Recovery now asks the same run-wide gate and fails closed.
function fixtureWith(runner: ControlledRunner, destruction?: DestructionPort, resumeFence = true): E2eFixture {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-fence-"))
  roots.push(root)
  return createE2eFixture({
    project: root,
    runner,
    resumeFence,
    materializeSkills: identityMaterializer,
    ...(destruction === undefined ? {} : { destruction }),
  })
}

// The checkpoint a crash leaves after an amendment removed A and added C, admission scheduled C, and
// the replacement for C was not started yet.
async function amendedCheckpoint(fixture: E2eFixture, runId: DagRunRecordV1["runId"]): Promise<DagRunRecordV1> {
  const record = fixture.manager.record(runId, parentSessionId)
  const helper = await fixture.manager.start({
    definition: definition("recovery-fence-c", [categoryNode("C")]),
    parentSessionId,
    rootSessionId: record.rootSessionId,
  })
  const nodeC = helper.snapshot.nodes[0]
  const definitionC = fixture.manager.record(helper.snapshot.runId, parentSessionId).definition.nodes[0]
  if (nodeC === undefined || definitionC === undefined) throw new Error("no node C")
  const paused: DagRunRecordV1 = {
    ...record,
    status: "paused",
    definition: {
      ...record.definition,
      nodes: [...record.definition.nodes.filter((node) => node.id === "B"), definitionC],
    },
    nodes: [...record.nodes.filter((node) => node.id === "B"), { ...nodeC, state: "scheduled" }],
    waves: [{ index: 0, nodeIds: ["B" as DagNodeId, nodeC.id] }],
    edges: [],
    criticalPath: [],
  }
  fixture.store.writeCheckpoint(runId, paused)
  return paused
}

async function recoverAndReadC(fixture: E2eFixture, runner: ControlledRunner, runId: DagRunRecordV1["runId"]) {
  const recovered = createDagRecovery({ store: fixture.store, taskManager: fixture.taskManager }).installPausedRuns(
    parentSessionId,
    () => undefined,
  )
  const first = await Promise.race([
    recovered.then(() => "recovered"),
    runner.whenStarted(3).then(() => "C started beside the live child"),
  ])
  return { first, nodeC: fixture.store.readCheckpoint<DagRunRecordV1>(runId)?.nodes.find((node) => node.id !== "B") }
}

// Stacked on #15133 a turn the fence allows while the run runs is followed by its node, so a live child
// of the settled run is one no fence re-checked (a host-session child outliving its process).
async function settledRunAB(fixture: E2eFixture, runner: ControlledRunner, resumeAAfterSettling: boolean) {
  const started = await fixture.start(definition("recovery-fence", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  runner.settle("B", completed("B"))
  await fixture.wait(runId)
  if (resumeAAfterSettling) await runner.selfResume("A")
  return runId
}

test("#11381 #given a recovery checkpoint with a removed node's live child whose stop stays pending #when the run recovers #then the scheduled new node fails closed and never starts", async () => {
  // given
  const runner = new ControlledRunner(undefined, { connectable: true })
  const fixture = fixtureWith(runner, undefined, false)
  const runId = await settledRunAB(fixture, runner, true)
  runner.child("A").connection.lose()
  await amendedCheckpoint(fixture, runId)

  // when
  const { first, nodeC } = await recoverAndReadC(fixture, runner, runId)

  // then
  expect(first).toBe("recovered")
  expect(nodeC).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
})

test("#11381 #given a recovery checkpoint with a removed node's refused turn whose teardown rejects #when the run recovers #then the scheduled new node fails closed and never starts", async () => {
  // given
  let taskA = ""
  const destruction: DestructionPort = {
    destroyResidentTask: async (taskId) => {
      if (taskId === taskA) throw new Error("teardown refused")
    },
  }
  const runner = new ControlledRunner()
  const fixture = fixtureWith(runner, destruction)
  const runId = await settledRunAB(fixture, runner, false)
  taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id ?? ""
  await amendedCheckpoint(fixture, runId)
  const unconfirmed = fixture.whenTaskEvent(taskA, "task_self_resume_stop_unconfirmed")
  void runner.selfResume("A")
  await unconfirmed

  // when
  const { first, nodeC } = await recoverAndReadC(fixture, runner, runId)

  // then
  expect(first).toBe("recovered")
  expect(nodeC).toMatchObject({ state: "failed", error: { code: "stale_attempt_alive" } })
})
