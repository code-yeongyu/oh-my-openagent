// #15133 on #15130: a node re-opened to follow its child's self-started turn is an ACTIVE node for the
// run-ownership rules. While it runs, the run is not settled and a retry of another node is refused
// run_still_active; once the followed turn ends the run settles and the retry is accepted.
import { afterEach, expect, setDefaultTimeout, test } from "bun:test"

import { answerOf } from "./__fixtures__/stack-composition"
import { cleanupSelfResumeRoots, selfResumeE2e } from "./scheduler-self-resume-e2e.test-harness"
import { drainMicrotasks, settlement, timeout } from "./scheduler-frontier.test-harness"
import type { DagNodeId } from "./types"
import { categoryNode } from "./__fixtures__/controlled-dag-e2e"
import { completed, failed } from "./__fixtures__/controlled-runner"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

afterEach(cleanupSelfResumeRoots)

test("#given a completed node re-opened to follow its child's own turn and a failed sibling #when the sibling is retried #then the retry is refused run_still_active until the followed turn ends, then accepted", async () => {
  // given
  const h = await selfResumeE2e("reentry-active", [categoryNode("A"), categoryNode("F")])
  const run = settlement(h.scheduler.run())
  await Promise.race([h.runner.whenStarted(2), timeout("both children to start")])
  h.runner.settle("A", completed("A"))
  await Promise.race([h.fixture.taskManager.waitFor(h.taskOf("A")), timeout("A to settle")])
  await drainMicrotasks()
  await Promise.race([h.runner.selfResume("A"), timeout("A's turn to be reopened")])
  await drainMicrotasks()
  expect(h.node("A")?.state).toBe("running")
  h.runner.settle("F", failed("F"))
  await Promise.race([h.fixture.taskManager.waitFor(h.taskOf("F")), timeout("F to settle")])
  await drainMicrotasks()

  // when
  const whileFollowed = await answerOf(() => h.scheduler.retryNode(h.runId, ["F" as DagNodeId]))

  // then
  expect(whileFollowed).toBe("run_still_active")
  expect(run.state.settled).toBe(false)
  h.runner.settle("A", completed("A-resumed"))
  expect(await Promise.race([run.outcome, timeout("the run to settle")])).toBe("completed")
  expect(h.scheduler.snapshot().status).toBe("failed")
  const reentry = h.scheduler.retryNode(h.runId, ["F" as DagNodeId])
  await Promise.race([h.runner.whenStarted(3), timeout("F's retried child to start")])
  h.runner.settle("F", completed("F"))
  expect((await Promise.race([reentry.run, timeout("the retried run to settle")])).status).toBe("completed")
})
