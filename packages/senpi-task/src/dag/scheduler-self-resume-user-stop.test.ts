// #15133 on #15135 R6: one decision about a self-started turn, with the user-stop row. While the user
// has stopped the run, a completed node's child's own turn is refused and held, recorded on the node,
// and no node re-opens. Resume does not continue the child and the resumed scheduler does not follow
// it. An explicit send then revives the child: that turn is the send's, never announced as
// self-started, and the node follows it as revived and folds its outcome.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"

import type { TaskManager } from "../manager/types"
import { parentSessionId } from "./__fixtures__/controlled-dag-e2e"
import { completed } from "./__fixtures__/controlled-runner"
import { THIS_HOST, unscheduledRun } from "./__fixtures__/stack-composition"
import { createDagRecovery } from "./recovery"
import { readDagNodeResult } from "./results"
import type { DagNodeId } from "./types"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

test("#given a run the user stopped #when a completed node's child starts a turn, the run resumes and the node is sent to #then the turn is held and not followed, Resume leaves the node completed, and the send's turn is followed as revived, never as self-started", async () => {
  // given: A finished, then the user stopped the run
  const run = await unscheduledRun(roots, ["A", "B"], { start: ["A"] })
  const taskA = run.taskOf("A")
  run.runner.settle("A", completed("A"))
  await run.fixture.taskManager.waitFor(taskA)
  run.write(
    "paused",
    { A: { state: "completed", taskId: taskA }, B: { state: "pending" } },
    { pause: { reason: "user_stop", pauseSeq: 1 } },
  )
  const nodeA = () => run.read()?.nodes.find((node) => node.id === "A")
  const transitionsOfA = () =>
    run.fixture.store
      .readEvents(run.runId, 0, { limit: 500 })
      .events.flatMap((event) =>
        event.type === "dag.node.transitioned" && String(event.nodeId) === "A"
          ? [`${event.from}->${event.to}:${event.reason.kind}`]
          : [],
      )

  // when: A's child starts a turn on its own while the run is stopped
  const stopped = run.fixture.whenTaskEvent(taskA, "task_self_resume_stop_confirmed")
  void run.runner.selfResume("A")
  await stopped

  // then: held and recorded, nothing re-opened
  expect(run.fixture.taskStore.load(taskA)?.status).toBe("completed")
  expect(nodeA()).toMatchObject({ state: "completed", heldTrigger: { taskId: taskA, count: 1 } })
  expect(transitionsOfA()).toEqual([])

  // when: the user resumes the run; the scheduler it installs is told only of self-started turns
  const announced: string[] = []
  const taskManager = new Proxy(run.fixture.taskManager, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (property !== "subscribeSelfResumed" || typeof value !== "function")
        return typeof value === "function" ? value.bind(target) : value
      return (taskId: string, listener: () => void) =>
        (value as NonNullable<TaskManager["subscribeSelfResumed"]>).call(target, taskId, () => {
          announced.push(taskId)
          listener()
        })
    },
  })
  const recovery = createDagRecovery({
    store: run.fixture.store,
    taskManager,
    hostPid: THIS_HOST,
    isProcessAlive: (pid) => pid === THIS_HOST,
    isRunHeldInProcess: () => false,
  })
  const installed = await recovery.installResumedRun(run.runId, parentSessionId, 1)
  if (installed.kind !== "installed") throw new Error(`the Resume did not install: ${installed.kind}`)
  installed.release()
  await run.runner.whenStarted(2)

  // then: Resume did not continue the child, and the resumed scheduler does not follow it
  expect(run.read()?.status).toBe("running")
  expect(nodeA()?.state).toBe("completed")
  expect(run.fixture.taskStore.load(taskA)?.status).toBe("completed")
  expect(transitionsOfA()).toEqual([])

  // when: the user sends to the node
  const sent = await installed.scheduler.sendToNode(run.runId, "A" as DagNodeId, "continue")

  // then: the send's turn is followed as revived; nothing announced it as self-started
  expect(sent.delivery).toBe("revive")
  expect(transitionsOfA()).toEqual(["completed->running:revived"])
  run.runner.settle("A", completed("A continued"))
  if (sent.delivery === "revive") await sent.settled
  run.runner.settle("B", completed("B"))
  const outcome = await installed.settled
  expect(outcome.record?.nodes.find((node) => node.id === "A")?.state).toBe("completed")
  expect(readDagNodeResult({ store: run.fixture.store, runId: run.runId, nodeId: "A" as DagNodeId })?.output).toBe(
    "output:A continued",
  )
  expect(nodeA()?.heldTrigger).toBeUndefined()
  expect(announced).toEqual([])
})
