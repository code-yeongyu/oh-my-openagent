import { describe, expect, test } from "bun:test"

import {
  node,
  recordFor,
  runId,
  SelfResumingTaskManager,
  startFixture,
  within,
} from "./scheduler-self-resume.test-harness"
import type { DagNodeId } from "./types"

// #12134 acceptance: a message sent to a node whose completed child resumed on its own reaches the
// resumed run as a steer, and that run settles the node without a new attempt.
describe("send to a node whose completed child resumed on its own (#12134)", () => {
  test("#given a re-opened node #when a message is sent to it #then the resumed child is steered and its completion settles the node once", async () => {
    const manager = new SelfResumingTaskManager()
    const fixture = startFixture(recordFor([node("A"), node("B", ["A"])]), manager)
    try {
      const running = fixture.scheduler.run()
      await within(manager.whenStarted("A"))
      manager.complete("A")
      await within(manager.whenStarted("B"))
      const reopened = fixture.reaches("A", "running")
      manager.selfResume("A")
      await within(reopened, 2_000, "node A to re-open")

      const sent = await within(fixture.scheduler.sendToNode(runId, "A" as DagNodeId, "also check the logs"))
      manager.complete("A")
      manager.complete("B")
      const result = await within(running)

      expect(sent).toEqual({ nodeId: "A" as DagNodeId, taskId: "task-A", delivery: "steer" })
      expect(manager.sends.map((input) => input.idOrName)).toEqual(["task-A"])
      expect(
        fixture.events().filter((event) => event.type === "dag.node.steered" && String(event.nodeId) === "A"),
      ).toEqual([expect.objectContaining({ delivery: "steer", taskId: "task-A" })])
      expect(manager.starts).toEqual(["A", "B"])
      expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:completed", "B:completed"])
      expect(result.status).toBe("completed")
      expect(manager.selfResumedListenerCount()).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })
})
