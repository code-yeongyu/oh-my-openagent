import { afterEach, expect, test } from "bun:test"
import { seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { AdmissionBarrier } from "../pause/admission-barrier"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, makeHandle, tempProject } from "./__fixtures__/manager-fakes"
import type { RunnerOutcome } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { createTaskRunPause } from "./run-pause"

afterEach(cleanupProjects)

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("saved Resume allocation was not granted")), 5000)
  })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

test.each([
  { model: "anthropic/claude", laneKey: "anthropic", sequence: 0 },
  { model: "test/original", laneKey: "test", sequence: 0 },
])("cold Resume keeps saved allocation ahead of newer work ($model)", async allocation => {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const record = seedRecord(store, { task_id: "st_0a675202", status: "paused", run_epoch: 7 })
  const concurrency = new TaskConcurrency({ provider_concurrency: { anthropic: 1, test: 1 }, global_concurrency: 1 })
  const barrier = new AdmissionBarrier()
  barrier.close("parent-1", 1)
  const native = makeHandle(record.task_id)
  const outcome = Promise.withResolvers<RunnerOutcome>()
  const order: string[] = []
  const pause = createTaskRunPause({
    store, concurrency, barrier, now: () => 0, liveHandle: () => native.handle,
    child: {
      pauseForRun: async () => ({ childSeq: 11 }),
      resumeTurn: async () => {
        order.push("resumed")
        return { turnId: "resumed-turn", outcome: outcome.promise }
      },
      holdInput: async () => ({ kind: "held", entryId: "unused", duplicate: false }),
    },
    track: () => {},
  })
  expect(concurrency.tryAcquire(`${allocation.laneKey}/foreign`, "foreign", 0)).toBe(true)
  concurrency.enqueue(`${allocation.laneKey}/later`, "later", 0, () => { order.push("later") })
  const resuming = pause.resumePausedTask(record.task_id, {
    parentSessionId: "parent-1", parentPauseSeq: 1, runRef: { kind: "task", id: record.task_id },
    resumeId: "resume-1", childSeqCutoff: 11, allocation,
    resumeCredential: barrier.resume("parent-1", 1, "resume-1"),
  })
  const finished = resuming.then(
    result => ({ kind: "resolved" as const, result }),
    (error: unknown) => ({ kind: "rejected" as const, error }),
  )
  try {
    expect(order).toEqual([])

    concurrency.releaseTask("foreign")
    const result = await bounded(finished)

    expect(result.kind).toBe("resolved")
    expect(order).toEqual(["resumed"])
    expect(concurrency.admission(record.task_id, 7)).toMatchObject(allocation)
    expect(store.load(record.task_id)?.status).toBe("running")
    expect(store.load(record.task_id)?.notification.run_epoch).toBe(7)
  } finally {
    concurrency.withdraw(`${allocation.laneKey}/later`, "later", 0)
    pause.forget(record.task_id)
    concurrency.releaseTask("later")
    concurrency.releaseTask("foreign")
    concurrency.releaseTask(record.task_id)
    outcome.resolve({ status: "cancelled" })
    await Promise.allSettled([resuming, finished])
  }
}, 15000)
