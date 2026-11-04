import { afterEach, expect, test } from "bun:test"
import { seedRecord } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createEngineRunPause } from "./engine-run-pause"

afterEach(cleanupProjects)

const PARENT = "parent"
const OWNER_HOST = 31_337
const THIS_HOST = 424_242

// #12349: after a reload the parent runs in a new process while the old one still owns its children.
function reloadedParent(ownerAlive: boolean) {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const child = seedRecord(store, {
    task_id: "st_0e2d0001", parent_session_id: PARENT, status: "running", execution_mode: "process", host_pid: OWNER_HOST,
  })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const calls: string[] = []
  const manager = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner }, hostPid: THIS_HOST, isProcessAlive: pid => pid === OWNER_HOST && ownerAlive,
    childPausePort: {
      pauseForRun: async () => { calls.push("pause"); return { childSeq: 3 } },
      resumeTurn: async () => { throw new Error("this host never resumes a child it does not hold") },
      holdInput: async () => { throw new Error("unused") },
    },
  })
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const pause = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: { getPauseState: () => state, fenceRun: () => undefined },
    lostRecovery: { delaysMs: [1], sleep: async () => undefined },
  })
  return {
    store, manager, pause, barrier, calls, taskId: child.task_id,
    async stopThenResume() {
      await pause.bridge.changed(PARENT, { ...state, change: "paused" })
      state = { pauseSeq: 7, holds: [] }
      await pause.bridge.changed(PARENT, { ...state, change: "resumed" })
      await pause.bridge.lostRecoverySettled(PARENT)
    },
  }
}

test("#12349: a Stop and Resume in a reloaded parent never pause, lose or end a child another live host owns", async () => {
  const h = reloadedParent(true)
  try {
    await h.pause.bridge.changed(PARENT, { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }], change: "paused" })
    // The owner still runs it: this host has no handle, so it must not write the child as paused.
    expect(h.store.load(h.taskId)).toMatchObject({ status: "running", host_pid: OWNER_HOST })
    expect(h.store.load(h.taskId)?.run_pause).toBeUndefined()
    expect(h.pause.registry.require(PARENT).participants[h.taskId]).toBeUndefined()

    await h.stopThenResume()
    expect(h.store.load(h.taskId)).toMatchObject({ status: "running", host_pid: OWNER_HOST })
    expect(Object.values(h.pause.registry.require(PARENT).participants).filter(entry => entry.state === "lost")).toEqual([])
    expect(h.barrier.state(PARENT).kind).toBe("open")
    expect(h.calls).toEqual([])
  } finally { h.manager.workpools.dispose() }
})

test("#12349: a child whose recorded host is gone is still paused by the Stop, under this run", async () => {
  const h = reloadedParent(false)
  try {
    await h.pause.bridge.changed(PARENT, { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }], change: "paused" })
    expect(h.store.load(h.taskId)).toMatchObject({ status: "paused", run_pause: { parent_session_id: PARENT, parent_pause_seq: 7 } })
    expect(h.pause.registry.require(PARENT).participants[h.taskId]?.state).toBe("held")
  } finally { h.manager.workpools.dispose() }
})
