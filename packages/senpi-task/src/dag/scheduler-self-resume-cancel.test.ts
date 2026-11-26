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
// cancelled with the run, whichever cancellation step the wake lands in.
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
      expect(result.nodes.find((entry) => entry.id === "A")?.state).toBe("cancelled")
      expect(manager.selfResumedListenerCount()).toBe(0)
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
      expect(manager.cancellations).toEqual(["D", "A"])
      expect(manager.taskOf("A").status).toBe("cancelled")
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:cancelled", "D:cancelled"])
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })
})
