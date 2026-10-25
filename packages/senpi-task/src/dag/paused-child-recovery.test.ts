import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../manager/__fixtures__/manager-fakes"
import { pausedRun } from "./__fixtures__/paused-run"
import { createDagRecovery } from "./recovery"

afterEach(cleanupProjects)

test("design 29: a lost paused child fails explicitly and is never redispatched", async () => {
  const h = await pausedRun()
  try {
    const { recoverPausedDagChildren } = await import("./paused-child-recovery")
    await recoverPausedDagChildren(h.options, {
      inspect: () => "lost",
      restorePaused: async () => { throw new Error("a lost child must not be respawned") },
    })
    expect(h.read().nodes.find(node => node.id === h.b)).toMatchObject({ state: "failed", error: { code: "lost_while_paused" } })
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("blocked")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 29: a failed paused restore releases the claimed run lease", async () => {
  const h = await pausedRun()
  try {
    const recovery = createDagRecovery({
      store: h.store, taskManager: h.manager,
      pausedChildren: {
        inspect: () => "restorable",
        restorePaused: async () => { throw new Error("restore failed") },
      },
    })
    await expect(recovery.installResumedRun(h.runId, "parent-1", 7)).rejects.toThrow()
    expect(h.read().leaseHolderPid).toBeUndefined()
    expect(h.read().status).toBe("paused")
  } finally { await h.manager.cancelTask(h.taskId) }
})

test("design 29: a restorable child is restored under inherited custody and remains paused", async () => {
  const h = await pausedRun()
  try {
    const restored: unknown[] = []
    const { recoverPausedDagChildren } = await import("./paused-child-recovery")
    await recoverPausedDagChildren(h.options, {
      inspect: () => "restorable",
      restorePaused: async (taskId, owner) => { restored.push({ taskId, owner }); return { childSeq: 11 } },
    })
    expect(restored).toEqual([{ taskId: h.taskId, owner: {
      parentSessionId: "parent-1", parentPauseSeq: 7, runRef: { kind: "dag", id: h.runId },
    } }])
    expect(h.read().nodes.find(node => node.id === h.b)).toMatchObject({ state: "paused", taskId: h.taskId })
    expect(h.read().pausedChildAcks?.[h.b]).toBe(11)
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})
