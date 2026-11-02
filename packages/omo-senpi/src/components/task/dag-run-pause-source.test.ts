import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { createDagRecovery, type InstalledDagRun } from "../../../../senpi-task/src/dag/recovery"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createDagRunPauseSource } from "./dag-run-pause-source"
import { guidePausedDag } from "../../../../senpi-task/src/dag/paused-controls"

afterEach(cleanupProjects)

test("DAG source retires scheduling before journaling Stop and preserves completed work", async () => {
  const h = await pausedRun()
  const retiring = Promise.withResolvers<void>()
  const barrier = new AdmissionBarrier()
  const source = createDagRunPauseSource({
    barrier, records: () => [h.read()], options: record => ({ ...h.options, initialRecord: record }),
    retire: () => retiring.promise, prepareResume: () => undefined,
    recovery: createDagRecovery({ store: h.store, taskManager: h.options.taskManager }),
    adopt: () => undefined, cancel: async () => undefined,
  })
  let pausing: Promise<void> | void = undefined
  try {
    pausing = source.quiesce?.("parent-1", 8)
    expect(h.read().pause?.pauseSeq).toBe(7)
    retiring.resolve()
    await pausing
    expect(h.read().pause).toEqual({ reason: "user_stop", pauseSeq: 8 })
    expect(h.read().nodes.find(node => node.id === "a")).toMatchObject({ state: "completed", output: "keep-a" })
    expect(h.read().nodes.find(node => node.id === h.c)?.state).toBe("blocked")
  } finally { retiring.resolve(); await pausing; await h.manager.cancelTask(h.taskId) }
})

test("DAG source acknowledges a fresh installation without waiting for its nodes", async () => {
  const h = await pausedRun()
  const barrier = new AdmissionBarrier()
  barrier.close("parent-1", 7)
  const credential = barrier.resume("parent-1", 7, "resume-1")
  let installed: InstalledDagRun | undefined
  const source = createDagRunPauseSource({
    barrier, records: () => [h.read()], options: record => ({ ...h.options, initialRecord: record }),
    retire: async () => undefined, prepareResume: () => undefined,
    recovery: createDagRecovery({ store: h.store, taskManager: h.options.taskManager }),
    adopt: entry => { installed = entry },
    cancel: async () => undefined,
  })
  try {
    await source.install?.("parent-1", 7, credential)
    expect(installed?.kind).toBe("installed")
    expect(h.read().status).toBe("running")
    expect(h.read().nodes.find(node => node.id === h.b)?.state).toBe("running")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally {
    await h.manager.cancelTask(h.taskId)
    await installed?.settled
  }
})

test("DAG source persists guidance custody before Resume and does not redeliver acknowledged input", async () => {
  const h = await pausedRun()
  const guide = guidePausedDag(h.options, h.runId, "human guidance", h.b)
  const delivered: string[] = []
  const source = createDagRunPauseSource({
    barrier: new AdmissionBarrier(), records: () => [h.read()], options: record => ({ ...h.options, initialRecord: record }),
    retire: async () => undefined, prepareResume: () => undefined,
    recovery: createDagRecovery({ store: h.store, taskManager: h.options.taskManager }),
    adopt: () => undefined, cancel: async () => undefined,
    deliverGuidance: async (taskId, input) => {
      expect(h.read().guidance?.find(entry => entry.id === input.inputId)?.state).toBe("dispatching")
      delivered.push(taskId)
      return { entryId: "held-entry" }
    },
  })
  try {
    await source.dispatchGuidance?.("parent-1", 7, "resume-1")
    expect(h.read().guidance?.find(entry => entry.id === guide.id)).toMatchObject({
      state: "delivered", deliveries: [{ taskId: h.taskId, entryId: "held-entry" }],
    })
    await source.dispatchGuidance?.("parent-1", 7, "resume-1")
    expect(delivered).toEqual([h.taskId])
    expect(h.read().status).toBe("paused")
  } finally { await h.manager.cancelTask(h.taskId) }
})
