import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { PauseRegistry, type PauseParticipant } from "../pause/registry"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("held first launch did not settle")), 5000)
  })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

function fixture() {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const make = (barrier: AdmissionBarrier, runner: FakeRunner) => createTaskManager({
    cwd, store, admissionBarrier: barrier, planner: categoryPlanner(),
    config: settings({ provider_concurrency: { test: 1 } }),
    runners: { "in-process": runner, process: runner },
  })
  return { store, make }
}

function participant(taskId: string): PauseParticipant {
  return {
    key: taskId, taskId, runEpoch: 0, runRef: { kind: "task", id: taskId },
    kind: "held_admission", state: "held", at: "2026-10-21T00:00:00.000Z",
    admission: { model: "test/limited", laneKey: "test", sequence: 1, phase: "pre_grant" },
  }
}

test("Stop withdraws the queued first launch without releasing a foreign root's lease", async () => {
  const { make, store } = fixture()
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const manager = make(barrier, runner)
  try {
    const foreign = await manager.start(baseSpec({
      parent_session_id: "foreign", root_session_id: "foreign", model: "test/limited", execution_mode: "in-process",
    }))
    const queued = await manager.start(baseSpec({
      parent_session_id: "parent", root_session_id: "parent", model: "test/limited", execution_mode: "in-process",
    }))
    if (foreign.kind !== "started" || queued.kind !== "started") throw new Error("expected both task identities")
    const registry = new PauseRegistry(store.stateDir, barrier)
    registry.begin("parent", 1, [participant(queued.task_id)])

    manager.withdrawAdmissions?.([queued.task_id])

    expect(manager.concurrency?.queuePosition("test/limited", queued.task_id)).toBeUndefined()
    expect(manager.concurrency?.leaseState(foreign.task_id, 0)).toBe("held")
    expect(manager.get(queued.task_id)?.status).toBe("pending")
    expect(runner.startedSpecs).toHaveLength(1)
  } finally {
    await Promise.all(manager.list({ scope: "all" }).map(({ record }) => manager.cancelTask(record.task_id)))
    manager.workpools.dispose()
  }
})

test.each([false, true])("held first launch resumes once with original identity and allocation (fresh manager: %s)", async freshManager => {
  const { make, store } = fixture()
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const manager = make(barrier, runner)
  let active = manager
  try {
    const foreign = await manager.start(baseSpec({
      parent_session_id: "foreign", root_session_id: "foreign", model: "test/limited", execution_mode: "in-process",
    }))
    const input = baseSpec({
      parent_session_id: "parent", root_session_id: "parent", model: "test/limited",
      execution_mode: "in-process", prompt: "queued-payload",
    })
    const queued = await manager.start(input)
    if (foreign.kind !== "started" || queued.kind !== "started") throw new Error("expected both task identities")
    let registry = new PauseRegistry(store.stateDir, barrier)
    registry.begin("parent", 1, [participant(queued.task_id)])
    manager.withdrawAdmissions?.([queued.task_id])
    registry.phase("parent", 1, "applied")
    await bounded(manager.cancelTask(foreign.task_id))
    await bounded(launchSettled(manager, queued.task_id))
    expect(runner.startedSpecs).toHaveLength(1)
    let resumedRunner = runner
    if (freshManager) {
      const restoredBarrier = new AdmissionBarrier()
      resumedRunner = new FakeRunner()
      active = make(restoredBarrier, resumedRunner)
      registry = new PauseRegistry(store.stateDir, restoredBarrier)
      registry.restore("parent", {
        pauseSeq: 1, rebuild: () => { throw new Error("the durable participant must survive reconstruction") },
      })
    }
    const saved = registry.require("parent").participants[queued.task_id]
    if (saved === undefined) throw new Error("missing durable admission")
    registry.requestResume("parent", 1, "resume-1")
    const credential = registry.authorizeResume("parent", 1, "resume-1")

    await active.resumeHeldTask?.(saved, credential)
    await bounded(launchSettled(active, queued.task_id))

    const launches = resumedRunner.startedSpecs.filter(spec => spec.taskId === queued.task_id)
    expect(launches).toHaveLength(1)
    expect(launches[0]?.prompt).toBe(input.prompt)
    expect(active.get(queued.task_id)?.notification.run_epoch).toBe(0)
    expect(active.get(queued.task_id)?.status).toBe("running")
    expect(active.concurrency?.admission(queued.task_id, 0)).toMatchObject({
      model: "test/limited", laneKey: "test", sequence: 1, phase: "post_grant",
    })
  } finally {
    await Promise.all(active.list({ scope: "all" }).map(({ record }) => active.cancelTask(record.task_id)))
    if (active !== manager) {
      for (const { record } of manager.list({ scope: "all" })) manager.forget(record.task_id, { path: "end", reason: "target_gone" })
      manager.workpools.dispose()
    }
    active.workpools.dispose()
  }
}, 15000)
