import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { pausedRun } from "./__fixtures__/paused-run"
import { reenterDagRun, retryDagNodes } from "./node-retry"
import { sendToDagNode } from "./node-send"
import { createDagRecovery } from "./recovery"
import { createDagManager } from "./manager"

afterEach(cleanupProjects)

test("design 28: a model cannot reenter a user-paused workflow", async () => {
  const h = await pausedRun()
  try {
    expect(() => reenterDagRun(h.options)).toThrow(expect.objectContaining({ code: "run_paused_by_user" }))
    expect(h.read().status).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 28: send to a paused node stores guidance without sending to its child", async () => {
  const h = await pausedRun()
  try {
    expect(await sendToDagNode(h.options, h.runId, h.b, "new instructions")).toMatchObject({ delivery: "guidance", nodeId: h.b })
    expect(h.read().guidance).toMatchObject([{ text: "new instructions", state: "draft", scope: { kind: "node", nodeId: h.b } }])
    expect(h.inProcess.handles.get(h.taskId)?.steerCalls).toEqual([])
    expect(h.read().nodes.find(node => node.id === "a")?.output).toBe("keep-a")
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: cancel then retry records a staged retry and leaves dependents blocked until Resume", async () => {
  const h = await pausedRun()
  const closed: string[] = []
  try {
    const { cancelPausedDagNode } = await import("./paused-controls")
    await cancelPausedDagNode(h.options, h.runId, h.b, { closeHold: async taskId => { closed.push(taskId) } })
    expect(h.read().nodes.find(node => node.id === h.b)?.state).toBe("cancelled")
    expect(closed).toEqual([h.taskId])
    const result = retryDagNodes(h.options, h.runId, [h.b])
    expect(result.record).toMatchObject({ status: "paused", retryOnResume: [h.b] })
    expect(h.inProcess.startedSpecs).toHaveLength(1)
    expect(h.read().nodes.find(node => node.id === h.b)?.attempt).toBe(1)
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("blocked")
    await result.scheduler.suspend()
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: a childless scheduled node is amendable but a paused child is not", async () => {
  const h = await pausedRun()
  try {
    const { pausedAmendmentUnsafe } = await import("./paused-controls")
    expect(pausedAmendmentUnsafe(h.record, h.b)).toBe(true)
    expect(pausedAmendmentUnsafe({ ...h.record, nodes: h.record.nodes.map(node =>
      node.id === h.c ? { ...node, state: "scheduled" } : node) }, h.c)).toBe(false)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: cancelled B makes C skipped when the user resumes", async () => {
  const h = await pausedRun()
  try {
    const { cancelPausedDagNode } = await import("./paused-controls")
    await cancelPausedDagNode(h.options, h.runId, h.b, { closeHold: async () => {} })
    const recovery = createDagRecovery({ store: h.store, taskManager: h.manager })
    const installed = await recovery.installResumedRun(h.runId, "parent-1", 7)
    if (installed.kind !== "installed") throw new Error("expected installation")
    await installed.settled
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("skipped")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: staged retry runs B then C only after the user resumes", async () => {
  const h = await pausedRun()
  try {
    const { cancelPausedDagNode } = await import("./paused-controls")
    await cancelPausedDagNode(h.options, h.runId, h.b, { closeHold: async () => {} })
    const staged = retryDagNodes(h.options, h.runId, [h.b])
    await staged.scheduler.suspend()
    expect(h.inProcess.startedSpecs).toHaveLength(1)
    const start = h.inProcess.start.bind(h.inProcess)
    h.inProcess.start = async spec => {
      const handle = await start(spec)
      const child = h.inProcess.handles.get(handle.task_id)
      if (child === undefined) throw new Error("missing fixture child")
      void child.waitForSubscription().then(() => child.settle({ status: "completed", finalResponse: "done" }))
      return handle
    }
    const recovery = createDagRecovery({ store: h.store, taskManager: h.manager })
    const installed = await recovery.installResumedRun(h.runId, "parent-1", 7)
    if (installed.kind !== "installed") throw new Error("expected installation")
    await installed.settled
    expect(h.read().nodes.map(node => node.state)).toEqual(["completed", "completed", "completed"])
    expect(h.inProcess.startedSpecs).toHaveLength(3)
    expect(h.read().nodes.find(node => node.id === "a")?.output).toBe("keep-a")
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 26: amending queued C while paused never reenters or changes paused B", async () => {
  const h = await pausedRun()
  try {
    const manager = createDagManager({ store: h.store, now: () => 0 })
    const changed = { ...h.definition, nodes: h.definition.nodes.map(node => node.id === "c" ? { ...node, prompt: "updated-c" } : node) }
    await manager.amend({ runId: h.runId, definition: changed, parentSessionId: "parent-1" })
    expect(h.read().pause).toEqual({ reason: "user_stop", pauseSeq: 7 })
    expect(h.read().nodes.find(node => node.id === h.b)?.state).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
    const unsafe = { ...h.definition, nodes: h.definition.nodes.map(node => node.id === "b" ? { ...node, prompt: "unsafe-b" } : node) }
    await expect(manager.amend({ runId: h.runId, definition: unsafe, parentSessionId: "parent-1" }))
      .rejects.toMatchObject({ code: "amend_running_node" })
  } finally { await h.manager.cancelTask(h.taskId) }
})
