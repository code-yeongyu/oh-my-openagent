import { describe, expect, test } from "bun:test"

import type { DagRunRecordV1 } from "./manager"
import {
  node,
  recordFor,
  runId,
  SelfResumingTaskManager,
  startFixture,
  within,
} from "./scheduler-self-resume.test-harness"
import type { DagNodeId } from "./types"

// #12134: a scheduler that takes over an active run (recovery-install hands it the run with a
// still-running child pre-attached) follows the run's completed nodes too. Their resident children
// can resume on its watch, or may already have resumed before it held the run.
function recoveredRun(manager: SelfResumingTaskManager) {
  const compiled = recordFor([node("A"), node("D")])
  const initialRecord: DagRunRecordV1 = {
    ...compiled,
    status: "running",
    generation: 2,
    nodes: compiled.nodes.map((entry) =>
      entry.id === "A"
        ? { ...entry, state: "completed", taskId: "task-A", attempt: 1, completedAt: compiled.createdAt }
        : { ...entry, state: "running", taskId: "task-D", attempt: 1, startedAt: compiled.createdAt },
    ),
  }
  manager.seed("A", "completed")
  manager.seed("D", "running")
  return startFixture(initialRecord, manager, { preAttachedTasks: new Map([["D" as DagNodeId, "task-D"]]) })
}

describe("a recovered active run whose completed node's child resumes on its own (#12134)", () => {
  test("#given a recovered run with a completed node #when its child resumes and fails #then the node re-opens and the run fails", async () => {
    const manager = new SelfResumingTaskManager()
    const fixture = recoveredRun(manager)
    try {
      const reopened = fixture.reaches("A", "running")
      const running = fixture.scheduler.run()
      manager.selfResume("A")
      await within(reopened, 2_000, "node A to re-open")
      manager.complete("A", "error")
      manager.complete("D")
      const result = await within(running)

      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:failed", "D:completed"])
      expect(result.status).toBe("failed")
      expect(manager.starts).toEqual([])
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  test("#given a completed node's child already resumed before the scheduler held the run #when the run is cancelled #then that child is cancelled too", async () => {
    const manager = new SelfResumingTaskManager()
    const fixture = recoveredRun(manager)
    manager.selfResume("A")
    try {
      const reopened = fixture.reaches("A", "running")
      const running = fixture.scheduler.run()
      await within(reopened, 2_000, "node A to re-open")
      await within(fixture.scheduler.cancel(runId))
      const result = await within(running)

      expect(result.status).toBe("cancelled")
      expect([...manager.cancellations].sort()).toEqual(["A", "D"])
      expect(manager.taskOf("A").status).toBe("cancelled")
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:cancelled", "D:cancelled"])
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })
})
