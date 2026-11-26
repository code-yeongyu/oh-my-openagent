import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TeardownStepDeadline } from "../lifecycle/teardown-budget"
import type { DagNodeId, DagRunId } from "./types"
import {
  categoryNode,
  createE2eFixture,
  definition,
  identityMaterializer,
  parentSessionId,
  type E2eFixture,
} from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed, failed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Stack review 1 of #15135: an explicit send to a DAG-owned child asks the owner's decision (the
// self-resume fence) before it reaches the child, and finds a refused turn by the record it resolved,
// whether the caller addressed the task by id or by name.
function fixtureWith(runner: ControlledRunner, teardownStepDeadline?: TeardownStepDeadline): E2eFixture {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-explicit-send-"))
  roots.push(root)
  return createE2eFixture({
    project: root,
    runner,
    materializeSkills: identityMaterializer,
    ...(teardownStepDeadline === undefined ? {} : { teardownStepDeadline }),
  })
}

async function settledRun(fixture: E2eFixture, runner: ControlledRunner, nodes: readonly string[], fail: string) {
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

const taskOf = (fixture: E2eFixture, runId: DagRunId, nodeId: string): string =>
  fixture.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: nodeId as DagNodeId })?.task_id ?? ""

const send = (fixture: E2eFixture, idOrName: string) =>
  fixture.taskManager.sendToTask({
    idOrName,
    message: "one more pass",
    callerSessionId: parentSessionId,
    allScope: true,
  })

describe("an explicit send to a DAG-owned child asks the owner first", () => {
  test("#given node A retried, its earlier attempt's child still resident #when that child is sent a message by id #then it is refused with the remedy and nothing is revived", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(runner)
    const runId = await settledRun(fixture, runner, ["A"], "A")
    const earlier = taskOf(fixture, runId, "A")
    fixture.retry(runId, ["A" as DagNodeId])
    await runner.whenStarted(2)

    // when
    const outcome = await send(fixture, earlier)

    // then
    expect(outcome).toMatchObject({ kind: "not_continuable", task_id: earlier })
    expect(outcome.kind === "not_continuable" ? outcome.suggestion : "").toContain("Retry the DAG node")
    expect(fixture.taskStore.load(earlier)?.status).toBe("error")
    runner.settle("A", completed("A again"))
    await fixture.wait(runId)
  })

  test("#given a node an amendment removed, its child still resident #when that child is sent a message #then it is refused and nothing is revived", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(runner)
    const runId = await settledRun(fixture, runner, ["A", "B"], "")
    const removed = taskOf(fixture, runId, "B")
    await (
      await fixture.amend(definition("explicit-send", [categoryNode("A")]), runId)
    ).run

    // when
    const outcome = await send(fixture, removed)

    // then
    expect(outcome).toMatchObject({ kind: "not_continuable", task_id: removed })
    expect(fixture.taskStore.load(removed)?.status).toBe("completed")
  })

  test("#given a cancelled run whose completed node's child is still resident #when that child is sent a message #then it is refused with the cancelled-run remedy and nothing is revived", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(runner)
    const started = await fixture.start(definition("explicit-send", [categoryNode("A"), categoryNode("B")]))
    const runId = started.snapshot.runId
    await runner.whenStarted(2)
    runner.settle("A", completed("A"))
    await fixture.whenEvent(
      runId,
      (event) => event.type === "dag.node.transitioned" && event.nodeId === "A" && event.to === "completed",
    )
    await fixture.cancel(runId, "stop the run")
    const done = taskOf(fixture, runId, "A")

    // when
    const outcome = await send(fixture, done)

    // then
    expect(fixture.manager.record(runId, parentSessionId).status).toBe("cancelled")
    expect(outcome).toMatchObject({ kind: "not_continuable", task_id: done })
    expect(outcome.kind === "not_continuable" ? outcome.suggestion : "").toContain("cancelled")
    expect(fixture.taskStore.load(done)?.status).toBe("completed")
  })

  test("#given a failed run's current claim #when its child is sent a message #then it is revived as the contract says", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(runner)
    const runId = await settledRun(fixture, runner, ["A", "B"], "B")
    const current = taskOf(fixture, runId, "A")

    // when
    const outcome = await send(fixture, current)

    // then
    expect(outcome).toMatchObject({ kind: "revived", task_id: current })
    runner.settle("A", completed("A again"))
  })

  test("#given a resident child no DAG owns #when it is sent a message #then it is revived", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(runner)
    const started = await fixture.taskManager.start({
      prompt: "plain",
      parent_session_id: parentSessionId,
      depth: 0,
      category: "quick",
      name: "plain",
      run_in_background: true,
    })
    if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
    await runner.whenStarted(1)
    runner.settle("plain", completed("plain"))
    await fixture.taskManager.waitFor(started.task_id)

    // when
    const outcome = await send(fixture, started.task_id)

    // then
    expect(outcome).toMatchObject({ kind: "revived", task_id: started.task_id })
    runner.settle("plain", completed("plain again"))
  })
})

describe("a refused turn is found by the record a name resolves to", () => {
  function manualDeadline() {
    const pending: Array<() => void> = []
    const deadline: TeardownStepDeadline = () => new Promise<void>((resolve) => pending.push(resolve))
    const expire = (): void => {
      for (const resolve of pending.splice(0)) resolve()
    }
    return { deadline, expire }
  }

  async function heldTurnPastItsBudget() {
    const runner = new ControlledRunner()
    const clock = manualDeadline()
    const fixture = fixtureWith(runner, clock.deadline)
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

  for (const address of ["id", "name"] as const) {
    test(`#given a refused turn whose stop is not confirmed #when the child is sent a message by ${address} #then the send waits for the stop and answers unresponsive`, async () => {
      // given
      const { fixture, runner, clock, taskA, first } = await heldTurnPastItsBudget()
      const second = runner.child("A").holdStops()

      // when
      const answer = send(fixture, address === "id" ? taskA : "A")
      const first_ = await Promise.race([
        second.reached.then(() => "waited for the stop"),
        answer.then(() => "answered"),
      ])
      expect(first_).toBe("waited for the stop")
      clock.expire()
      const outcome = await answer

      // then
      expect(outcome).toMatchObject({ kind: "unresponsive", task_id: taskA })
      expect(fixture.taskStore.load(taskA)?.status).toBe("completed")
      first.release()
      second.release()
    })

    test(`#given a refused turn whose stop is not confirmed #when the child is cancelled by ${address} #then the cancel re-issues that stop and answers cancel_pending without cancelling the record`, async () => {
      // given
      const { fixture, runner, clock, taskA, first } = await heldTurnPastItsBudget()
      const second = runner.child("A").holdStops()

      // when
      const answer = fixture.taskManager.cancelTask(address === "id" ? taskA : "A", "stop it")
      const first_ = await Promise.race([
        second.reached.then(() => "re-issued the stop"),
        answer.then(() => "answered"),
      ])
      expect(first_).toBe("re-issued the stop")
      clock.expire()
      const outcome = await answer

      // then
      expect(outcome).toMatchObject({ kind: "cancel_pending", task_id: taskA })
      expect(fixture.taskStore.load(taskA)?.status).toBe("completed")
      first.release()
      second.release()
    })
  }
})
