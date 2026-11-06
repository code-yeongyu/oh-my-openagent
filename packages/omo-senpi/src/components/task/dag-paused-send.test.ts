import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { createDagManager } from "../../../../senpi-task/src/dag/manager"
import { sendToDagNode } from "../../../../senpi-task/src/dag/node-send"
import type { DagNodeId } from "../../../../senpi-task/src/dag/types"
import { runDagTool } from "./dag-tool"

afterEach(cleanupProjects)

test("design 28: workflow send reports durable guidance without creating a child turn", async () => {
  const h = await pausedRun()
  try {
    const result = await runDagTool({
      manager: createDagManager({ store: h.store }),
      parentSessionId: () => "parent-1", rootSessionId: () => "parent-1",
      send: (runId, nodeId, message) => sendToDagNode(h.options, runId, nodeId as DagNodeId, message),
    }, { action: "send", run_id: h.runId, node_id: h.b, message: "guidance only" })
    expect(result.details).toMatchObject({ kind: "sent", delivery: "guidance" })
    expect(h.read().guidance).toHaveLength(1)
    expect(h.read().status).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 28: workflow resume is refused on a user-paused run", async () => {
  const h = await pausedRun()
  try {
    const result = await runDagTool({
      manager: createDagManager({ store: h.store }),
      parentSessionId: () => "parent-1", rootSessionId: () => "parent-1",
    }, { action: "resume", run_id: h.runId })
    expect(result.details).toMatchObject({ kind: "error", error: { code: "run_paused_by_user" } })
    expect(h.read().status).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: workflow cancel_node cancels only its paused child and closes its inherited hold", async () => {
  const h = await pausedRun()
  try {
    const closed: string[] = []
    const { cancelPausedDagNode } = await import("../../../../senpi-task/src/dag/paused-controls")
    const result = await runDagTool({
      manager: createDagManager({ store: h.store }),
      parentSessionId: () => "parent-1", rootSessionId: () => "parent-1",
      cancelNode: (runId, nodeId) => cancelPausedDagNode(h.options, runId, nodeId as DagNodeId, {
        closeHold: async taskId => { closed.push(taskId) },
      }),
    }, { action: "cancel_node", run_id: h.runId, node_id: h.b })
    expect(result.details).toMatchObject({ kind: "node_cancelled", node_id: h.b })
    expect(closed).toEqual([h.taskId])
    expect(h.read().status).toBe("paused")
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("blocked")
  } finally { await h.manager.cancelTask(h.taskId) }
})
