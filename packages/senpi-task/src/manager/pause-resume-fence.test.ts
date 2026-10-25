import { afterEach, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "./__fixtures__/manager-fakes"
import type { RunnerOutcome } from "./child-handle"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Resume signal did not arrive")), 5000) })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

test.each([false, true])("design 40: stale Resume cannot modify newer ownership (Resume 2 started: %s)", async newerResume => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const runner = new FakeRunner()
  const barrier = new AdmissionBarrier()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const fresh = Promise.withResolvers<RunnerOutcome>()
  const manager = createTaskManager({
    cwd, store, config: settings(), planner: categoryPlanner(),
    runners: { "in-process": runner, process: runner }, admissionBarrier: barrier,
    childPausePort: {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 8 }
      },
      resumeTurn: async (_child, request) => {
        if (request.resumeId === "resume-2") return { turnId: "fresh-turn", outcome: fresh.promise }
        entered.resolve()
        await finish.promise
        return { turnId: "stale-turn", outcome: Promise.resolve({ status: "completed", finalResponse: "must not settle" }) }
      },
      holdInput: async () => ({ kind: "held", entryId: "guide", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ root_session_id: "parent-1" }))
  if (started.kind !== "started") throw new Error("expected started")
  await bounded(launchSettled(manager, started.task_id))
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 1, runRef: { kind: "task" as const, id: started.task_id } }
  barrier.close("parent-1", 1)
  await manager.pauseTask(started.task_id, owner)
  const credential = barrier.resume("parent-1", 1, "resume-1")
  const resuming = manager.resumePausedTask(started.task_id, {
    ...owner, resumeId: "resume-1", childSeqCutoff: 8, resumeCredential: credential,
  })
  const finished = resuming.then(
    result => ({ kind: "resolved" as const, result }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  )
  try {
    await bounded(Promise.race([entered.promise, resuming]))
    barrier.close("parent-1", 2)
    await bounded(manager.pauseTask(started.task_id, { ...owner, parentPauseSeq: 2 }))
    if (newerResume) {
      const currentCredential = barrier.resume("parent-1", 2, "resume-2")
      await bounded(manager.resumePausedTask(started.task_id, {
        ...owner, parentPauseSeq: 2, resumeId: "resume-2", childSeqCutoff: 8, resumeCredential: currentCredential,
      }))
    }
    finish.resolve()
    expect(await bounded(finished)).toMatchObject({ kind: "rejected", error: { code: "run_admission_held" } })
    expect(manager.get(started.task_id)?.status).toBe(newerResume ? "running" : "paused")
    expect(manager.concurrency?.leaseState(started.task_id, 0)).toBe(newerResume ? "held" : "parked")
  } finally {
    finish.resolve()
    const cancellations = manager.list({ scope: "all" }).map(({ record }) => manager.cancelTask(record.task_id))
    fresh.resolve({ status: "cancelled" })
    await Promise.all(cancellations)
    await Promise.allSettled([resuming, finished])
    manager.workpools.dispose()
  }
}, 15000)
