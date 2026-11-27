// Settled DAG runs over the real TaskManager for the explicit-send tests (#11381): a node's child left
// resident, and a refused self-started turn whose stop is held past its budget.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TeardownStepDeadline } from "../../lifecycle/teardown-budget"
import type { DagNodeId, DagRunId } from "../types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  type E2eFixture,
} from "./controlled-dag-e2e"
import { ControlledRunner, completed, failed } from "./controlled-runner"

export function fixtureWith(
  roots: string[],
  runner: ControlledRunner,
  teardownStepDeadline?: TeardownStepDeadline,
): E2eFixture {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-explicit-send-"))
  roots.push(root)
  return createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    ...(teardownStepDeadline === undefined ? {} : { teardownStepDeadline }),
  })
}

export async function settledRun(
  fixture: E2eFixture,
  runner: ControlledRunner,
  nodes: readonly string[],
  fail: string,
) {
  const started = await fixture.start(
    definition(
      "explicit-send",
      nodes.map((id) => categoryNode(id)),
    ),
  )
  const runId = started.snapshot.runId
  await runner.whenStarted(nodes.length)
  for (const id of nodes) runner.settle(id, id === fail ? failed(id) : completed(id))
  await fixture.wait(runId)
  return runId
}

export const taskOf = (fixture: E2eFixture, runId: DagRunId, nodeId: string): string =>
  fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: nodeId as DagNodeId })?.task_id ?? ""

export const send = (fixture: E2eFixture, idOrName: string, callerSessionId = parentSessionId, allScope = true) =>
  fixture.taskManager.sendToTask({
    idOrName,
    message: "one more pass",
    callerSessionId,
    ...(allScope ? { allScope } : {}),
  })

function manualDeadline() {
  const pending: Array<() => void> = []
  const deadline: TeardownStepDeadline = () => new Promise<void>((resolve) => pending.push(resolve))
  const expire = (): void => {
    for (const resolve of pending.splice(0)) resolve()
  }
  return { deadline, expire }
}

export async function heldTurnPastItsBudget(roots: string[]) {
  const runner = new ControlledRunner()
  const clock = manualDeadline()
  const fixture = fixtureWith(roots, runner, clock.deadline)
  const runId = await settledRun(fixture, runner, ["A", "B"], "B")
  const taskA = taskOf(fixture, runId, "A")
  const first = runner.child("A").holdStops()
  const unconfirmed = fixture.whenTaskEvent(taskA, "task_self_resume_stop_unconfirmed")
  void runner.selfResume("A")
  await first.reached
  clock.expire()
  await unconfirmed
  return { fixture, runner, clock, taskA, first }
}
