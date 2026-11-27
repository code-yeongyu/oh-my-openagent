import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TeardownStepDeadline } from "../lifecycle/teardown-budget"
import type { DestructionPort } from "../steering"
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

// Delta review 2 of #15135, finding 1: a refused self-started turn left the record settled before its
// stop was awaited, so the still-working turn was invisible to the outstanding stop and the cancel
// drain, and permanently so when the stop timed out. The stop is owed until the runner confirms it.
function manualDeadline() {
  const pending: Array<() => void> = []
  const deadline: TeardownStepDeadline = () => new Promise<void>((resolve) => pending.push(resolve))
  const expire = (): void => {
    for (const resolve of pending.splice(0)) resolve()
  }
  return { deadline, expire }
}

async function runWithSettledA(options: { readonly failB: boolean; readonly destruction?: DestructionPort }) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-refused-stop-"))
  roots.push(root)
  const runner = new ControlledRunner()
  const clock = manualDeadline()
  const fixture = createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    teardownStepDeadline: clock.deadline,
    ...(options.destruction === undefined ? {} : { destruction: options.destruction }),
  })
  const started = await fixture.start(definition("refused-stop", [categoryNode("A"), categoryNode("B")]))
  const runId = started.snapshot.runId
  await runner.whenStarted(2)
  runner.settle("A", completed("A"))
  await fixture.whenEvent(
    runId,
    (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
  )
  if (options.failB) {
    runner.settle("B", failed("B"))
    expect((await fixture.wait(runId)).status).toBe("failed")
  }
  const taskA = fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: "A" as DagNodeId })?.task_id
  if (taskA === undefined) throw new Error("node A owns no task")
  const owed = () => fixture.manager.snapshot(runId, parentSessionId).outstandingStop
  return { fixture, runner, runId, taskA, clock, owed }
}

test("#11381 #given a held refusal whose abort is gated #when the run is read, retried and cancelled #then the stop is owed until the abort lands, and the child then revives on send", async () => {
  // given
  const { fixture, runner, runId, taskA, owed } = await runWithSettledA({ failB: true })
  const held = runner.child("A").holdStops()
  void runner.selfResume("A")
  await held.reached

  // when
  const owedWhileGated = owed()
  const retried = (() => {
    try {
      fixture.retry(runId, ["B" as DagNodeId])
      return "admitted"
    } catch (error) {
      return (error as { readonly code?: string }).code
    }
  })()
  let cancelSettled = false
  const cancel = fixture.cancel(runId, "stop the run").then(() => {
    cancelSettled = true
  })
  const settledWhileGated = cancelSettled
  held.release()
  await cancel

  // then
  expect(owedWhileGated).toEqual({ liveTaskIds: [taskA] })
  expect(retried).toBe("run_still_active")
  expect(settledWhileGated).toBe(false)
  expect(owed()).toBeUndefined()
  expect(fixture.taskStore.load(taskA)).toMatchObject({ status: "completed", residency_state: "resident" })
  const sent = await fixture.send(runId, "A" as DagNodeId, "one more pass")
  runner.settle("A", completed("A again"))
  if (sent.delivery === "revive") await sent.settled
  expect(sent.delivery).toBe("revive")
})

test("#11381 #given a held refusal whose abort outlives its budget #when the run is read, sent to and cancelled #then the obligation stays reported and retryable until the runner confirms, and nothing is destroyed", async () => {
  // given
  const destroyed: string[] = []
  const destruction: DestructionPort = { destroyResidentTask: async (taskId) => void destroyed.push(taskId) }
  const { fixture, runner, runId, taskA, clock, owed } = await runWithSettledA({ failB: true, destruction })
  const first = runner.child("A").holdStops()
  const unconfirmed = fixture.whenTaskEvent(taskA, "task_self_resume_stop_unconfirmed")
  void runner.selfResume("A")
  await first.reached
  clock.expire()
  await unconfirmed

  // when
  const owedAfterTimeout = owed()
  const second = runner.child("A").holdStops()
  const sent = fixture.send(runId, "A" as DagNodeId, "too early").then(
    () => "sent",
    (error: { readonly code?: string }) => error.code,
  )
  await second.reached
  clock.expire()
  const sendAnswer = await sent
  first.release()
  second.release()
  await fixture.cancel(runId, "finish the stop")

  // then
  expect(owedAfterTimeout).toEqual({ liveTaskIds: [taskA] })
  expect(sendAnswer).toBe("node_unresponsive")
  expect(owed()).toBeUndefined()
  expect(destroyed).toEqual([])
  expect(fixture.taskStore.load(taskA)).toMatchObject({ status: "completed", residency_state: "resident" })
})

test("#11381 #given a retired refusal in a cancelled run whose teardown is gated #when the run is read and cancelled again #then the stop is owed until the teardown lands", async () => {
  // given
  let releaseTeardown = (): void => undefined
  let teardownReached = (): void => undefined
  const reached = new Promise<void>((resolve) => (teardownReached = resolve))
  const gate = new Promise<void>((resolve) => (releaseTeardown = resolve))
  const gated = new Set<string>()
  const destruction: DestructionPort = {
    destroyResidentTask: async (taskId) => {
      if (!gated.has(taskId)) return
      teardownReached()
      await gate
    },
  }
  const { fixture, runner, runId, taskA, owed } = await runWithSettledA({ failB: false, destruction })
  await fixture.cancel(runId, "stop the run")
  gated.add(taskA)
  void runner.selfResume("A")
  await reached

  // when
  const owedWhileGated = owed()
  let cancelSettled = false
  const cancel = fixture.cancel(runId, "again").then(() => {
    cancelSettled = true
  })
  const settledWhileGated = cancelSettled
  releaseTeardown()
  await cancel

  // then
  expect(owedWhileGated).toEqual({ liveTaskIds: [taskA] })
  expect(settledWhileGated).toBe(false)
  expect(owed()).toBeUndefined()
})

test("#11381 #given a held refusal whose abort lands at once #when the node is sent a message #then no obligation remains and the child revives as before", async () => {
  // given
  const { fixture, runner, runId, taskA, owed } = await runWithSettledA({ failB: true })
  const refused = fixture.whenTaskEvent(taskA, "task_self_resume_refused")
  void runner.selfResume("A")
  await refused

  // when
  const sent = await fixture.send(runId, "A" as DagNodeId, "one more pass")
  runner.settle("A", completed("A again"))
  if (sent.delivery === "revive") await sent.settled

  // then
  expect(sent.delivery).toBe("revive")
  expect(owed()).toBeUndefined()
})
