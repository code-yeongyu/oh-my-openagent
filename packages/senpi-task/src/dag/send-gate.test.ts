import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ChildPlanner } from "../manager/types"
import type { DagRunRecordV1 } from "./manager"
import { createDagScheduler } from "./scheduler"
import type { DagNodeId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  planner,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function project(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-send-gate-"))
  roots.push(root)
  return root
}

async function sendAnswer(send: Promise<unknown>): Promise<string> {
  return send.then(
    () => "sent",
    (error: { readonly code?: string }) => error.code ?? "error",
  )
}

// Delta review 2 of #15135, finding 3: explicit send revived a failed run's child without asking the
// child gate - while the run still owed a stop, and for a task of a superseded attempt.
test("#11381 #given a run failed by the stale-child fence that still owes a stop #when a finished sibling is sent a message #then the send is refused and nothing starts", async () => {
  // given
  const runner = new ControlledRunner(undefined, { connectable: true })
  const fixture = createE2eFixture({ project: project(), runner, materializeSkills: identityMaterializer })
  const started = await fixture.start(definition("send-owed", [categoryNode("A"), categoryNode("B")]))
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
  runner.child("A").connection.lose()
  const record = fixture.manager.record(runId, parentSessionId)
  const helper = await fixture.manager.start({
    definition: definition("send-owed-c", [categoryNode("C")]),
    parentSessionId,
    rootSessionId: record.rootSessionId,
  })
  const nodeC = helper.snapshot.nodes[0]
  const definitionC = fixture.manager.record(helper.snapshot.runId, parentSessionId).definition.nodes[0]
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
  const failedRun = await createDagScheduler({
    store: fixture.store,
    taskManager: fixture.taskManager,
    initialRecord: active,
  }).run()
  expect(failedRun.status).toBe("failed")

  // when
  const answer = await sendAnswer(fixture.send(runId, "B" as DagNodeId, "one more pass"))

  // then
  expect(answer).toBe("run_still_active")
  expect(runner.startedSpecs).toHaveLength(2)
})

test("#11381 #given a failed replacement whose node still names the superseded attempt's task #when the node is sent a message #then the old definition's child is never revived", async () => {
  // given
  const refusing: ChildPlanner = (spec) =>
    spec.prompt === "do A-fixed"
      ? { kind: "error", error: { code: "unknown_target", message: "no route for the replacement" } }
      : planner(spec)
  const runner = new ControlledRunner()
  const fixture = createE2eFixture({
    project: project(),
    runner,
    materializeSkills: identityMaterializer,
    childPlanner: refusing,
  })
  const started = await fixture.start(definition("send-superseded", [categoryNode("A")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(1)
  runner.settle("A", completed("A"))
  await fixture.wait(runId)
  const old = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  const reentry = await fixture.amend(
    definition("send-superseded", [categoryNode("A", [], { prompt: "do A-fixed" })]),
    runId,
  )
  const failedRun = await reentry.run
  expect(failedRun.nodes[0]).toMatchObject({ state: "failed", taskId: old })

  // when
  const answer = await sendAnswer(fixture.send(runId, "A" as DagNodeId, "one more pass"))

  // then
  expect(answer).toBe("node_not_continuable")
  expect(runner.startedSpecs).toHaveLength(1)
  expect(fixture.taskStore.load(old ?? "")?.status).toBe("completed")
})
