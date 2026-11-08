import { afterEach, expect, test } from "bun:test"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createEngineRunPause } from "./engine-run-pause"

afterEach(cleanupProjects)

test("the parent graph withdraws and resumes a plain queued task without an injected admission adapter", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const manager = createTaskManager({
    cwd, store, admissionBarrier: barrier, planner: categoryPlanner(),
    config: settings({ provider_concurrency: { test: 1 } }),
    runners: { "in-process": runner, process: runner },
  })
  try {
    const foreign = await manager.start(baseSpec({
      parent_session_id: "foreign", root_session_id: "foreign", model: "test/limited", execution_mode: "in-process",
    }))
    const queued = await manager.start(baseSpec({
      parent_session_id: "parent", root_session_id: "parent", model: "test/limited", execution_mode: "in-process",
    }))
    if (foreign.kind !== "started" || queued.kind !== "started") throw new Error("expected both task identities")
    let state: EnginePauseState = { pauseSeq: 1, holds: [{ kind: "session_hold", key: "session_hold:1" }] }
    const pause = createEngineRunPause({
      stateDir: store.stateDir, manager, barrier,
      runtime: { getPauseState: () => state, fenceRun: () => {} },
    })
    await pause.bridge.changed("parent", { ...state, change: "paused" })
    expect(manager.concurrency?.queuePosition("test/limited", queued.task_id)).toBeUndefined()
    expect(pause.registry.require("parent").participants[queued.task_id]).toMatchObject({
      kind: "held_admission", state: "held",
      admission: { model: "test/limited", laneKey: "test", sequence: 1, phase: "pre_grant" },
    })
    await manager.cancelTask(foreign.task_id)

    state = { pauseSeq: 1, holds: [] }
    await pause.bridge.changed("parent", { ...state, change: "resumed" })
    await launchSettled(manager, queued.task_id)

    expect(runner.startedSpecs.filter(spec => spec.taskId === queued.task_id)).toHaveLength(1)
    expect(manager.get(queued.task_id)?.status).toBe("running")
    expect(manager.get(queued.task_id)?.notification.run_epoch).toBe(0)
    expect(pause.registry.require("parent").phase).toBe("resumed")
    expect(barrier.state("parent").kind).toBe("open")
  } finally {
    await Promise.all(manager.list({ scope: "all" }).map(({ record }) => manager.cancelTask(record.task_id)))
    manager.workpools.dispose()
  }
})
