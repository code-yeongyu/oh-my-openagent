// #15133 on #15135, composition (a): one cancellation rule. A node's child whose stop already
// answered that it was finished starts a turn on its own while the run is still being cancelled. The
// run-wide stop must reach it again, with no second drain and no node following the refused turn.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"

import { cleanupSelfResumeRoots, selfResumeE2e } from "./scheduler-self-resume-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import { categoryNode } from "./__fixtures__/controlled-dag-e2e"
import { completed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupSelfResumeRoots)

test("#given a cancel whose stop found a node's child finished #when that child starts a turn on its own before the cancel settles #then the cancel waits for that turn's stop and ends with no live owned child and nothing followed", async () => {
  // given: S's start holds the admission batch open, so the cancel begins while A is still attached
  const h = await selfResumeE2e("cancel-resume", [categoryNode("A"), categoryNode("S")])
  const sStart = h.starts.hold("S")
  const run = settlement(h.scheduler.run())
  await Promise.race([h.runner.whenStarted(1), timeout("A's child to start")])
  await Promise.race([sStart.reached, timeout("S's start to reach the gate")])
  const taskA = h.taskOf("A")
  const cancel = settlement(h.scheduler.cancel(h.runId, "operator stop"))
  await drainMicrotasks()
  h.runner.settle("A", completed("A"))
  await Promise.race([h.fixture.taskManager.waitFor(taskA), timeout("A's record to settle")])
  const releaseStop = h.holdDestroy(taskA)
  const answers: string[] = []
  h.onStopAnswered(async (taskId, outcome) => {
    if (taskId !== taskA) return
    answers.push(outcome.kind)
    if (answers.length > 1) return
    // when: right after the stop answered that A is finished, A's child starts a turn on its own
    const refused = h.fixture.whenTaskEvent(taskA, "task_self_resume_refused")
    void h.runner.selfResume("A")
    await Promise.race([refused, timeout("the fence to refuse A's turn")])
  })
  sStart.release()
  await Promise.race([h.fixture.whenTaskEvent(taskA, "task_self_resume_refused"), timeout("A's refused turn")])
  await drainMicrotasks()

  // then: the refused turn counts as live and the cancel waits for its stop
  expect(answers[0]).toBe("noop")
  expect(h.liveChildren()).toContain(taskA)
  expect(cancel.state.settled).toBe(false)
  releaseStop()
  expect(await Promise.race([cancel.outcome, timeout("the cancel to settle")])).toBe("completed")
  expect(await Promise.race([run.outcome, timeout("the run to settle")])).toBe("completed")
  expect(h.scheduler.snapshot().status).toBe("cancelled")
  expect(h.liveChildren()).toEqual([])
  expect(h.fixture.taskStore.load(taskA)?.status).toBe("completed")
  expect(h.reopenedNodes()).toEqual([])
})
