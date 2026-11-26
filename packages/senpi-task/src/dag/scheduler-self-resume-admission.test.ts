import { describe, expect, test } from "bun:test"

import type { TaskStatus } from "../state"
import {
  deferred,
  node,
  recordFor,
  SelfResumingTaskManager,
  startFixture,
  within,
} from "./scheduler-self-resume.test-harness"

// #12134: a dependent that was scheduled on a completion but denied residency never ran, so when that
// dependency's child resumes on its own the dependent waits for the resumed outcome again instead
// of starting on the superseded completion, and it never counts as having consumed that output.
describe("a residency-denied dependent of a node whose child resumes on its own (#12134)", () => {
  test("#given a dependent parked behind residency #when its dependency resumes and then completes #then the dependent starts only after the resumed completion", async () => {
    let denyB = true
    let aStatusAtBStart: TaskStatus | undefined
    const manager = new SelfResumingTaskManager({
      denyResidency: (nodeId) => nodeId === "B" && denyB,
      onStart: (nodeId) => {
        if (nodeId === "B") aStatusAtBStart = manager.taskOf("A").status
      },
    })
    const fixture = startFixture(recordFor([node("A"), node("B", ["A"])]), manager)
    try {
      // The wake must land while the scheduler is parked behind the denial, not before it parks.
      const bParked = fixture.reaches("B", "scheduled", "residency_queued")
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      manager.complete("A")
      await within(bParked)

      denyB = false
      const reopened = fixture.reaches("A", "running")
      const bReturned = fixture.reaches("B", "pending")
      manager.selfResume("A")
      await within(reopened)
      await within(Promise.race([bReturned, manager.whenStarted("B")]))
      manager.complete("A")
      await within(manager.whenStarted("B"))
      manager.complete("B")
      const result = await within(running)

      expect(aStatusAtBStart).toBe("completed")
      expect(result.status).toBe("completed")
      expect(manager.starts).toEqual(["A", "B"])
      expect(result.diagnostics.filter((entry) => entry.kind === "node_flag")).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })

  test("#given a dependent denied residency while its dependency resumes #when the resumed run fails #then the dependent is skipped, never started and never flagged", async () => {
    const admissionEntered = deferred()
    const releaseAdmission = deferred()
    let bAdmissions = 0
    const manager = new SelfResumingTaskManager({
      startGate: async (nodeId) => {
        if (nodeId !== "B" || ++bAdmissions !== 1) return
        admissionEntered.resolve()
        await releaseAdmission.promise
      },
      denyResidency: (nodeId) => nodeId === "B" && bAdmissions === 1,
      onStart: (nodeId) => {
        if (nodeId === "B") queueMicrotask(() => manager.complete("B"))
      },
    })
    const fixture = startFixture(recordFor([node("A"), node("B", ["A"])]), manager)
    try {
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      manager.complete("A")
      await within(admissionEntered.promise)

      manager.selfResume("A")
      manager.complete("A", "error")
      releaseAdmission.resolve()
      const result = await within(running)

      expect(manager.denials).toEqual(["B"])
      expect(manager.starts).toEqual(["A"])
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:failed", "B:skipped"])
      expect(result.status).toBe("failed")
      expect(result.diagnostics.filter((entry) => entry.kind === "node_flag")).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
})
