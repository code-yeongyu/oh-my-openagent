// #15133 on #15135, compositions (b) and (c): one decision about a turn a finished node child starts
// on its own. The manager's fence and the scheduler holding the run ask the same function, so a turn
// the fence allows is followed by its node, and a turn it refuses never re-opens a node and counts as
// live until its stop is confirmed.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"

import { cleanupSelfResumeRoots, selfResumeE2e } from "./scheduler-self-resume-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import { readDagNodeResult } from "./results"
import type { DagNodeId } from "./types"
import { categoryNode, parentSessionId } from "./__fixtures__/controlled-dag-e2e"
import { completed, failed, infrastructureFailed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupSelfResumeRoots)

type Harness = Awaited<ReturnType<typeof selfResumeE2e>>

function reaches(h: Harness, nodeId: string, state: string): Promise<void> {
  if (h.node(nodeId)?.state === state) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = h.scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== state) return
      unsubscribe()
      resolve()
    })
  })
}

// Resolves once the manager answered a self-started turn, either way.
function selfResumeAnswered(h: Harness, taskId: string): Promise<void> {
  return Promise.race([
    h.fixture.whenTaskEvent(taskId, "task_self_resume_refused"),
    h.fixture.whenTaskEvent(taskId, "task_self_resumed"),
    timeout(`the manager to answer ${taskId}'s self-started turn`),
  ])
}

describe("a turn a finished DAG node child starts on its own (#12134 on #11381)", () => {
  test("#given the node's current claim in a running run #when its child starts a turn on its own #then the fence allows it and the node follows it and folds the resumed outcome", async () => {
    // given
    const h = await selfResumeE2e("follow-allowed", [categoryNode("A"), categoryNode("B")])
    const run = settlement(h.scheduler.run())
    await Promise.race([h.runner.whenStarted(2), timeout("both children to start")])
    const aCompleted = reaches(h, "A", "completed")
    h.runner.settle("A", completed("A"))
    await Promise.race([aCompleted, timeout("A to complete")])

    // when
    await Promise.race([h.runner.selfResume("A"), timeout("A's turn to be reopened")])
    await drainMicrotasks()

    // then
    expect(h.node("A")?.state).toBe("running")
    expect(h.reopenedNodes()).toEqual(["A"])
    const refolded = reaches(h, "A", "completed")
    h.runner.settle("A", completed("A-resumed"))
    await Promise.race([refolded, timeout("A's resumed outcome to fold")])
    expect(readDagNodeResult({ store: h.fixture.store, runId: h.runId, nodeId: "A" as DagNodeId })?.output).toBe(
      "output:A-resumed",
    )
    h.runner.settle("B", completed("B"))
    expect(await Promise.race([run.outcome, timeout("the run to settle")])).toBe("completed")
    expect(h.scheduler.snapshot().status).toBe("completed")
  })

  test("#given a failed run #when a completed node's child starts a turn on its own #then it is refused, re-opens nothing, and the run owes its stop until the stop is confirmed", async () => {
    // given
    const h = await selfResumeE2e("refuse-failed-run", [categoryNode("A"), categoryNode("F")])
    const run = settlement(h.scheduler.run())
    await Promise.race([h.runner.whenStarted(2), timeout("both children to start")])
    h.runner.settle("A", completed("A"))
    h.runner.settle("F", failed("F"))
    await Promise.race([run.outcome, timeout("the run to settle")])
    expect(h.scheduler.snapshot().status).toBe("failed")
    const taskA = h.taskOf("A")
    const stop = h.runner.child("A").holdStops()

    // when
    const answered = selfResumeAnswered(h, taskA)
    void h.runner.selfResume("A")
    await answered

    // then
    expect(h.fixture.taskStore.load(taskA)?.status).toBe("completed")
    expect(h.reopenedNodes()).toEqual([])
    expect(h.fixture.manager.snapshot(h.runId, parentSessionId).outstandingStop).toEqual({ liveTaskIds: [taskA] })
    await Promise.race([stop.reached, timeout("the refused turn's stop to be sent")])
    const confirmed = h.fixture.whenTaskEvent(taskA, "task_self_resume_stop_confirmed")
    stop.release()
    await Promise.race([confirmed, timeout("the refused turn's stop to be confirmed")])
    expect(h.fixture.manager.snapshot(h.runId, parentSessionId).outstandingStop).toBeUndefined()
  })

  test("#given a node whose attempt was superseded by its automatic retry #when the old attempt's child starts a turn on its own #then it is refused, re-opens nothing, and counts as live until its stop is confirmed", async () => {
    // given
    const h = await selfResumeE2e("refuse-superseded", [categoryNode("A"), categoryNode("B")])
    const retryStart = h.starts.hold("A", 2)
    const run = settlement(h.scheduler.run())
    await Promise.race([h.runner.whenStarted(2), timeout("both children to start")])
    const oldTask = h.taskOf("A")
    const retryScheduled = h.clock.whenScheduled(1)
    h.runner.settle("A", infrastructureFailed("A"))
    await Promise.race([retryScheduled, timeout("A's infrastructure retry to be scheduled")])
    h.clock.advance()
    await Promise.race([retryStart.reached, timeout("A's retry start to reach the gate")])
    const releaseStop = h.holdDestroy(oldTask)

    // when
    const answered = selfResumeAnswered(h, oldTask)
    void h.runner.selfResume("A")
    await answered

    // then
    expect(h.fixture.taskStore.load(oldTask)?.status).toBe("error")
    expect(h.reopenedNodes()).toEqual([])
    expect(h.liveChildren()).toContain(oldTask)
    const confirmed = h.fixture.whenTaskEvent(oldTask, "task_self_resume_stop_confirmed")
    releaseStop()
    await Promise.race([confirmed, timeout("the refused turn's stop to be confirmed")])
    expect(h.liveChildren()).not.toContain(oldTask)

    retryStart.release()
    await h.scheduler.cancel(h.runId, "test teardown").catch(() => undefined)
    await Promise.race([run.outcome, timeout("the run to settle after teardown")])
  })
})
