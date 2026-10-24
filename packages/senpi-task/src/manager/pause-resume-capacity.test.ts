import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("superseded capacity wait did not settle")), 5000) })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

test.each([false, true])("design 40: a second Stop disarms a capacity-waiting Resume (fresh owner: %s)", async freshOwner => {
  const cwd = tempProject()
  const runner = new FakeRunner()
  let barrier = new AdmissionBarrier()
  let nativeResumes = 0
  const makeManager = () => createTaskManager({
    cwd, store: createTaskRecordStore({ project_dir: cwd }),
    config: settings({ default_concurrency: 1, global_concurrency: 1 }), planner: categoryPlanner(),
    runners: { "in-process": runner, process: runner }, admissionBarrier: barrier,
    childPausePort: {
      pauseForRun: async (child, owner) => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: owner.parentPauseSeq + 10 }
      },
      resumeTurn: async () => {
        nativeResumes += 1
        return { turnId: "unexpected", outcome: Promise.resolve({ status: "completed", finalResponse: "not authorized" }) }
      },
      holdInput: async () => ({ kind: "held", entryId: "guide", duplicate: false }),
    },
  })
  const original = makeManager()
  let manager = original
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent", model: "test/original" }))
  if (started.kind !== "started") throw new Error("expected first child")
  await bounded(launchSettled(manager, started.task_id))
  const owner = { parentSessionId: "parent", parentPauseSeq: 1, runRef: { kind: "task" as const, id: started.task_id } }
  barrier.close("parent", 1)
  await bounded(manager.pauseTask(started.task_id, owner))
  // A persisted observed model is not the allocator's original model.
  createTaskRecordStore({ project_dir: cwd }).mutate(started.task_id, record => ({ ...record, model: "observed/canonical" }))
  if (freshOwner) {
    const saved = manager.get(started.task_id)
    const handle = runner.handles.get(started.task_id)?.handle
    if (saved === undefined || handle === undefined) throw new Error("missing paused child")
    manager.forget(started.task_id, { path: "park" })
    barrier = new AdmissionBarrier()
    barrier.close("parent", 1)
    manager = makeManager()
    const attached = await manager.reattach(saved, handle)
    if (!attached.ok) throw new Error(attached.reason)
  }
  const foreign = await manager.start(baseSpec({ parent_session_id: "foreign", root_session_id: "foreign" }))
  if (foreign.kind !== "started") throw new Error("expected foreign child")
  await bounded(launchSettled(manager, foreign.task_id))
  const resuming = manager.resumePausedTask(started.task_id, {
    ...owner, resumeId: "resume-1", childSeqCutoff: 11, resumeCredential: barrier.resume("parent", 1, "resume-1"),
    allocation: { model: "test/original", laneKey: "test/original", sequence: 0 },
  })
  const finished = resuming.then(
    result => ({ kind: "resolved" as const, result }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  )
  try {
    expect(manager.concurrency?.leaseState(foreign.task_id, 0)).toBe("held")
    expect(manager.concurrency?.leaseState(started.task_id, 0)).toBe(freshOwner ? undefined : "parked")
    expect(nativeResumes).toBe(0)
    barrier.close("parent", 2)
    await bounded(manager.pauseTask(started.task_id, { ...owner, parentPauseSeq: 2 }))
    expect(await bounded(finished)).toMatchObject({ kind: "rejected", error: { code: "run_admission_held" } })
    await bounded(manager.cancelTask(foreign.task_id))
    expect(manager.get(started.task_id)?.status).toBe("paused")
    expect(manager.concurrency?.leaseState(started.task_id, 0)).toBe(freshOwner ? undefined : "parked")
    expect(nativeResumes).toBe(0)
    const next = await manager.start(baseSpec({ parent_session_id: "other", root_session_id: "other" }))
    if (next.kind !== "started") throw new Error("expected the independent root to acquire capacity")
    await bounded(launchSettled(manager, next.task_id))
    expect(manager.concurrency?.leaseState(next.task_id, 0)).toBe("held")
    expect(runner.startedSpecs).toHaveLength(3)
  } finally {
    await Promise.all(manager.list({ scope: "all" }).map(({ record }) => manager.cancelTask(record.task_id)))
    await Promise.allSettled([resuming, finished])
    manager.workpools.dispose()
    if (original !== manager) original.workpools.dispose()
  }
}, 15000)
