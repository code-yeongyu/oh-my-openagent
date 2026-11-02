import { afterEach, expect, test } from "bun:test"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { pausedRun } from "../../../../senpi-task/src/dag/__fixtures__/paused-run"
import { createDagManager } from "../../../../senpi-task/src/dag/manager"
import { cancelPausedDagNode } from "../../../../senpi-task/src/dag/paused-controls"
import { createDagRuntimeControls } from "./dag-runtime-controls"

afterEach(cleanupProjects)

test("paused send and staged retry cannot recreate or adopt a retired scheduler", async () => {
  const h = await pausedRun()
  const { initialRecord: _initialRecord, ...schedulerOptions } = h.options
  const controls = createDagRuntimeControls({
    coreManager: createDagManager({ store: h.store }), schedulerOptions, schedulers: new Map(),
    sessionId: () => "parent-1",
    controller: () => { throw new Error("paused controls must not create a scheduler") },
    adoptReentry: () => { throw new Error("paused controls must not adopt a scheduler") },
    clearAdmissionLatch: () => undefined,
  })
  try {
    expect((await controls.send(h.runId, h.b, "guide only")).delivery).toBe("guidance")
    await cancelPausedDagNode(h.options, h.runId, h.b, { closeHold: async () => undefined })
    await controls.retry(h.runId, [h.b])
    expect(h.read().retryOnResume).toEqual([h.b])
    expect(h.read().status).toBe("paused")
    expect(h.inProcess.startedSpecs).toHaveLength(1)
  } finally { await h.manager.cancelTask(h.taskId) }
})
