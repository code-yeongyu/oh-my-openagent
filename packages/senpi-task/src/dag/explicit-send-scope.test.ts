import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import type { SendOutcome } from "../steering"
import type { DagNodeId } from "./types"
import { categoryNode, definition, parentSessionId, type E2eFixture } from "./__fixtures__/controlled-dag-e2e"
import { ControlledRunner, completed } from "./__fixtures__/controlled-runner"
import { fixtureWith, heldTurnPastItsBudget, send, settledRun, taskOf } from "./__fixtures__/explicit-send"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Stack review 2 of #15135: the scope decision comes first. A caller outside a task's session sees only
// steering's scope denial, at once, whatever the task's DAG claim, run status or refused-stop state.
const OUTSIDER = "session-of-someone-else"

const sendFromOutside = (fixture: E2eFixture, taskId: string) => send(fixture, taskId, OUTSIDER, false)

function scopeDenial(taskId: string): SendOutcome {
  return {
    kind: "scope_denied",
    task_id: taskId,
    owning_session_id: parentSessionId,
    reason: `Task ${taskId} belongs to session ${parentSessionId}; pass all_scope to send across sessions.`,
  }
}

describe("an out-of-scope send learns nothing but the scope denial", () => {
  test("#given a superseded attempt's resident child #when a caller outside its session sends to it #then the answer is the scope denial and the child is untouched", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(roots, runner)
    const runId = await settledRun(fixture, runner, ["A"], "A")
    const earlier = taskOf(fixture, runId, "A")
    fixture.retry(runId, ["A" as DagNodeId])
    await runner.whenStarted(2)

    // when
    const outcome = await sendFromOutside(fixture, earlier)

    // then
    expect(outcome).toEqual(scopeDenial(earlier))
    expect(fixture.taskStore.load(earlier)?.status).toBe("error")
    runner.settle("A", completed("A again"))
    await fixture.wait(runId)
  })

  test("#given a cancelled run's resident child #when a caller outside its session sends to it #then the answer is the scope denial and the child is untouched", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(roots, runner)
    const started = await fixture.start(definition("scope-cancelled", [categoryNode("A"), categoryNode("B")]))
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
    const outcome = await sendFromOutside(fixture, done)

    // then
    expect(outcome).toEqual(scopeDenial(done))
    expect(fixture.taskStore.load(done)?.status).toBe("completed")
  })

  test("#given a current claim whose refused turn's stop is held at its gate #when a caller outside its session sends to it #then the scope denial answers while the stop is still held, and the record is untouched", async () => {
    // given
    const { fixture, runner, taskA, first } = await heldTurnPastItsBudget(roots)
    const second = runner.child("A").holdStops()

    // when
    const answer = sendFromOutside(fixture, taskA)
    const settledFirst = await Promise.race([
      answer.then(() => "answered while the stop was held"),
      second.reached.then(() => "waited behind the stop"),
    ])

    // then
    expect(settledFirst).toBe("answered while the stop was held")
    expect(await answer).toEqual(scopeDenial(taskA))
    expect(fixture.taskStore.load(taskA)?.status).toBe("completed")
    first.release()
    second.release()
  })

  test("#given a plain resident child no DAG owns #when a caller outside its session sends to it #then the answer is the same scope denial", async () => {
    // given
    const runner = new ControlledRunner()
    const fixture = fixtureWith(roots, runner)
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
    const outcome = await sendFromOutside(fixture, started.task_id)

    // then
    expect(outcome).toEqual(scopeDenial(started.task_id))
    expect(fixture.taskStore.load(started.task_id)?.status).toBe("completed")
  })
})
