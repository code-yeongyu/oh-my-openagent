import { describe, expect, test } from "bun:test"

import {
  deferred,
  node,
  recordFor,
  runId,
  SelfResumingTaskManager,
  startFixture,
  within,
} from "./scheduler-self-resume.test-harness"

// #12134: a completed node's child that resumes on its own while the run is being cancelled is
// cancelled with the run, whichever cancellation step the wake lands in. Stacked on #15135, the
// run-wide stop is the one cancellation rule: after the cancel no child the run owns is live.
function liveOwned(manager: SelfResumingTaskManager): readonly string[] {
  return manager
    .findOwnedTasks({ kind: "dag", runId })
    .filter((task) => task.status === "pending" || task.status === "running" || task.status === "paused")
    .map((task) => task.task_id)
}
describe("DAG cancellation while a completed node's child resumes on its own (#12134)", () => {
  test("#given cancellation waits on an in-flight admission #when a completed node's child resumes #then the resumed child is cancelled with the run", async () => {
    const admissionEntered = deferred()
    const releaseAdmission = deferred()
    const manager = new SelfResumingTaskManager({
      startGate: async (nodeId) => {
        if (nodeId !== "B") return
        admissionEntered.resolve()
        await releaseAdmission.promise
      },
    })
    const fixture = startFixture(recordFor([node("A"), node("D"), node("B", ["D"])]), manager)
    try {
      const aCompleted = fixture.reaches("A", "completed")
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      await within(manager.whenStarted("D"))
      manager.complete("A")
      await within(aCompleted)
      manager.complete("D")
      await within(admissionEntered.promise)

      const cancelled = fixture.scheduler.cancel(runId)
      manager.selfResume("A")
      releaseAdmission.resolve()
      await within(cancelled)
      const result = await within(running)

      expect(result.status).toBe("cancelled")
      expect(manager.cancellations).toContain("A")
      expect(manager.taskOf("A").status).toBe("cancelled")
      expect(liveOwned(manager)).toEqual([])
      // One decision with the fence: a turn started during the cancel is refused, never followed.
      expect(result.nodes.find((entry) => entry.id === "A")?.state).toBe("completed")
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  test("#given an attached child that finished before its fold so its cancel was a noop #when it resumes under a new run epoch during another child's cancel #then the new run is cancelled too", async () => {
    let resumed = false
    const manager = new SelfResumingTaskManager({
      onCancel: (nodeId) => {
        if (nodeId !== "D" || resumed) return
        resumed = true
        manager.selfResume("A")
      },
    })
    const fixture = startFixture(recordFor([node("A"), node("D")]), manager)
    try {
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      await within(manager.whenStarted("D"))
      // Same turn: the cancel starts before the scheduler can fold A's settlement.
      manager.complete("A")
      const cancelled = fixture.scheduler.cancel(runId)
      await within(cancelled)
      const result = await within(running)

      expect(liveOwned(manager)).toEqual([])
      expect(manager.taskOf("A").status).toBe("cancelled")
      expect(manager.taskOf("A").notification.run_epoch).toBe(2)
      expect(result.status).toBe("cancelled")
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:cancelled", "D:cancelled"])
    } finally {
      fixture.cleanup()
    }
  })

  test("#given cancellation is already cancelling the attached children #when a completed node's child resumes #then the resumed child is cancelled too", async () => {
    const manager = new SelfResumingTaskManager({
      onCancel: (nodeId) => {
        if (nodeId === "D") manager.selfResume("A")
      },
    })
    const fixture = startFixture(recordFor([node("A"), node("D")]), manager)
    try {
      const aCompleted = fixture.reaches("A", "completed")
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      await within(manager.whenStarted("D"))
      manager.complete("A")
      await within(aCompleted)

      await within(fixture.scheduler.cancel(runId))
      const result = await within(running)

      expect(result.status).toBe("cancelled")
      expect(liveOwned(manager)).toEqual([])
      expect(manager.taskOf("A").status).toBe("cancelled")
      // One decision with the fence: a turn started during the cancel is refused, never followed.
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:completed", "D:cancelled"])
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })
})
