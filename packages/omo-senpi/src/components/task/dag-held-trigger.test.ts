import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import { parentSessionId } from "../../../../senpi-task/src/dag/__fixtures__/controlled-dag-e2e"
import { completed } from "../../../../senpi-task/src/dag/__fixtures__/controlled-runner"
import { DEAD_HOST, THIS_HOST, unscheduledRun } from "../../../../senpi-task/src/dag/__fixtures__/stack-composition"
import { UNSOLICITED_TURN_CAUSE } from "../../../../senpi-task/src/dag/held-trigger"
import { createDagRecovery } from "../../../../senpi-task/src/dag/recovery"
import type { DagNodeId } from "../../../../senpi-task/src/dag/types"
import { runRows } from "./dag-status-row-format"
import { runDagTool } from "./dag-tool"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// R6 (#11381): while the USER has stopped a run, a finished child's self-started turn is held and
// recorded on its node; a shutdown pause keeps allowing it.
async function stoppedRunWithFinishedA(pause: "user_stop" | "shutdown") {
  const run = await unscheduledRun(roots, ["A", "B"], { start: ["A"] })
  const taskA = run.taskOf("A")
  run.runner.settle("A", completed("A"))
  await run.fixture.taskManager.waitFor(taskA)
  const nodes = { A: { state: "completed" as const, taskId: taskA }, B: { state: "pending" as const } }
  run.write(
    "paused",
    nodes,
    pause === "user_stop" ? { pause: { reason: "user_stop", pauseSeq: 1 } } : { previousLeaseHolderPid: DEAD_HOST },
  )
  const nodeA = () => run.read()?.nodes.find((node) => node.id === "A")
  const heldEvents = () =>
    run.fixture.store
      .readEvents(run.runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.diagnostic.added")
  const triggerHeld = async () => {
    const confirmed = run.fixture.whenTaskEvent(taskA, "task_self_resume_stop_confirmed")
    void run.runner.selfResume("A")
    await confirmed
  }
  const toolText = async (action: "snapshot" | "attach") =>
    (
      await runDagTool(
        { manager: run.fixture.manager, parentSessionId: () => parentSessionId, rootSessionId: () => parentSessionId },
        { action, run_id: run.runId },
      )
    ).content
      .map((part) => ("text" in part ? part.text : ""))
      .join("")
  const widget = () => runRows(run.fixture.manager.snapshot(run.runId, parentSessionId), undefined, { maxWidth: 220 })
  return { run, taskA, nodeA, heldEvents, triggerHeld, toolText, widget }
}

describe("a finished child's self-started turn while its run is stopped", () => {
  test("#given a run the user stopped #when a completed node's child starts a turn #then the turn is held (aborted, the record stays completed and resident, the stop counted until confirmed) and the node, the tool text and the widget row say a trigger was held", async () => {
    // given
    const { run, taskA, nodeA, toolText, widget } = await stoppedRunWithFinishedA("user_stop")
    const held = run.runner.child("A").holdStops()
    const confirmed = run.fixture.whenTaskEvent(taskA, "task_self_resume_stop_confirmed")

    // when
    void run.runner.selfResume("A")
    const answer = await Promise.race([
      held.reached.then(() => "held"),
      run.fixture.whenTaskEvent(taskA, "task_self_resumed").then(() => "reopened"),
    ])
    expect(answer).toBe("held")
    const owedWhileStopping = run.fixture.taskManager.selfResumeStopPending?.(taskA)
    held.release()
    await confirmed

    // then
    expect(owedWhileStopping).toBe(true)
    expect(run.fixture.taskManager.selfResumeStopPending?.(taskA)).toBe(false)
    expect(run.runner.child("A").stops.aborted).toBe(1)
    expect(run.fixture.taskStore.load(taskA)).toMatchObject({ status: "completed", residency_state: "resident" })
    const trigger = nodeA()?.heldTrigger
    expect(trigger).toMatchObject({ taskId: taskA, cause: UNSOLICITED_TURN_CAUSE, count: 1 })
    expect(trigger?.firstAt).toBe(trigger?.lastAt)
    expect(nodeA()?.state).toBe("completed")
    const notice = `Node A held while stopped: a trigger fired at ${trigger?.lastAt}; send to the node to continue.`
    expect(await toolText("snapshot")).toContain(notice)
    expect(await toolText("attach")).toContain(notice)
    expect(widget().find((row) => row.includes(" A "))).toContain("held while stopped: send to continue")
  })

  test("#given a run paused for a shutdown #when a completed node's child starts a turn #then the turn is allowed and nothing is recorded", async () => {
    // given
    const { run, taskA, nodeA, heldEvents } = await stoppedRunWithFinishedA("shutdown")
    const reopened = run.fixture.whenTaskEvent(taskA, "task_self_resumed")

    // when
    void run.runner.selfResume("A")
    await reopened

    // then
    expect(run.fixture.taskStore.load(taskA)?.status).toBe("running")
    expect(nodeA()?.heldTrigger).toBeUndefined()
    expect(heldEvents()).toEqual([])
    run.runner.settle("A", completed("A again"))
  })

  test("#given a run the user stopped #when the same node's child starts two turns #then the node keeps one record: count 2 with the first and the last time", async () => {
    // given
    const { nodeA, heldEvents, triggerHeld } = await stoppedRunWithFinishedA("user_stop")

    // when
    await triggerHeld()
    await triggerHeld()

    // then
    const [first, second] = heldEvents()
    expect(heldEvents()).toHaveLength(2)
    expect(nodeA()?.heldTrigger).toMatchObject({ count: 2, firstAt: first?.at, lastAt: second?.at })
  })

  test("#given a held trigger #when the user resumes the run and then sends to the node #then the record is still shown after Resume, the send revives the child and clears it", async () => {
    // given
    const { run, taskA, nodeA, triggerHeld, toolText } = await stoppedRunWithFinishedA("user_stop")
    await triggerHeld()
    const recovery = createDagRecovery({
      store: run.fixture.store,
      taskManager: run.fixture.taskManager,
      hostPid: THIS_HOST,
      isProcessAlive: (pid) => pid === THIS_HOST,
      isRunHeldInProcess: () => false,
    })

    // when
    const installed = await recovery.installResumedRun(run.runId, parentSessionId, 1)
    if (installed.kind !== "installed") throw new Error(`the Resume did not install: ${installed.kind}`)
    installed.release()
    await run.runner.whenStarted(2)
    const shownAfterResume = await toolText("snapshot")
    const triggerAfterResume = nodeA()?.heldTrigger
    const sent = await installed.scheduler.sendToNode(run.runId, "A" as DagNodeId, "continue")

    // then
    expect(run.read()?.status).toBe("running")
    expect(triggerAfterResume).toMatchObject({ taskId: taskA, count: 1 })
    expect(shownAfterResume).toContain("Node A held while stopped")
    expect(sent.delivery).toBe("revive")
    expect(nodeA()?.heldTrigger).toBeUndefined()
    expect(await toolText("snapshot")).not.toContain("held while stopped")
    run.runner.settle("A", completed("A continued"))
    run.runner.settle("B", completed("B"))
    if (sent.delivery === "revive") await sent.settled
    await installed.settled
  })
})
