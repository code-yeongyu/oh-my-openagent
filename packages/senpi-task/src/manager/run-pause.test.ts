import { afterEach, describe, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import type { ChildPausePort } from "../pause/ports"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, makeManager, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

describe("manager run pause capacity and turn ownership", () => {
  test("#given a refused parent pause #when the child completes during the request #then ordinary completion is not trapped behind a pause intent", async () => {
    const cwd = tempProject()
    const store = createTaskRecordStore({ project_dir: cwd })
    const runner = new FakeRunner()
    const refusal = Promise.withResolvers<{ readonly refused: "wrong_parent" }>()
    const manager = createTaskManager({
      cwd, store, config: settings(), planner: categoryPlanner(),
      runners: { "in-process": runner, process: runner },
      childPausePort: {
        pauseForRun: () => refusal.promise,
        resumeTurn: async () => ({ otherHoldLive: true }),
        holdInput: async () => ({ kind: "held", entryId: "guide", duplicate: false }),
      },
    })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const terminal = manager.waitFor(started.task_id)
    const pausing = manager.pauseTask(started.task_id, {
      parentSessionId: "wrong-parent", parentPauseSeq: 1, runRef: { kind: "task", id: started.task_id },
    })
    runner.handles.get(started.task_id)?.settle({ status: "completed", finalResponse: "finished normally" })
    refusal.resolve({ refused: "wrong_parent" })
    expect(await pausing).toEqual({ refused: "wrong_parent" })
    expect(manager.get(started.task_id)?.status).not.toBe("paused")
    expect(await terminal).toMatchObject({ status: "completed", final_response: "finished normally" })
  })

  test("#given a paused child #when cancelled through the manager #then it becomes terminal and releases every lease", async () => {
    const { manager, store } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    store.transition(started.task_id, { type: "pause", timestamp: new Date(0).toISOString() })
    const terminal = manager.waitFor(started.task_id)
    expect(await manager.cancelTask(started.task_id)).toMatchObject({ kind: "cancelled", previous_status: "paused" })
    expect(await terminal).toMatchObject({ status: "cancelled" })
    expect(manager.concurrency?.leaseState(started.task_id, 0)).toBeUndefined()
  })

  test("#given a running child #when paused then immediately resumed #then the same epoch settles only its new turn", async () => {
    const cwd = tempProject()
    const store = createTaskRecordStore({ project_dir: cwd })
    const runner = new FakeRunner()
    let resumes = 0
    const childPausePort: ChildPausePort = {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({
          status: "error", failure: { kind: "child-turn-failed", message: "aborted" },
        })
        return { childSeq: 9 }
      },
      resumeTurn: async () => {
        resumes += 1
        return { turnId: "new-turn", outcome: Promise.resolve({ status: "completed", finalResponse: "new result" }) }
      },
      holdInput: async () => ({ kind: "held", entryId: "held", duplicate: false }),
    }
    const manager = createTaskManager({
      store, cwd, config: settings(), planner: categoryPlanner(),
      runners: { "in-process": runner, process: runner }, childPausePort,
    })
    const result = await manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected started")
    const before = manager.get(result.task_id)
    const owner = { parentSessionId: "parent-1", parentPauseSeq: 1, runRef: { kind: "task" as const, id: result.task_id } }
    expect(typeof manager.pauseTask).toBe("function")
    const ack = await manager.pauseTask(result.task_id, owner)
    if ("refused" in ack) throw new Error("expected the task parent to own this child")
    expect(ack.childSeq).toBe(9)
    expect(manager.get(result.task_id)?.status).toBe("paused")
    expect(manager.concurrency?.leaseState(result.task_id, 0)).toBe("parked")
    expect(manager.concurrency?.getCount(before?.model ?? "")).toBe(0)
    const terminal = manager.waitFor(result.task_id)
    await manager.resumePausedTask(result.task_id, { ...owner, resumeId: "resume-1", childSeqCutoff: ack.childSeq })
    expect(await terminal).toMatchObject({ status: "completed", final_response: "new result" })
    expect(manager.get(result.task_id)?.notification.run_epoch).toBe(before?.notification.run_epoch)
    expect(resumes).toBe(1)
  })

  test("#given a newer child hold #when parent resumes with an older cutoff #then park capacity and leave the child paused", async () => {
    const cwd = tempProject()
    const store = createTaskRecordStore({ project_dir: cwd })
    const runner = new FakeRunner()
    const childPausePort: ChildPausePort = {
      pauseForRun: async child => {
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 8 }
      },
      resumeTurn: async () => ({ otherHoldLive: true, childSeq: 9 }),
      holdInput: async () => ({ kind: "held", entryId: "held", duplicate: false }),
    }
    const manager = createTaskManager({
      store, cwd, config: settings(), planner: categoryPlanner(),
      runners: { "in-process": runner, process: runner }, childPausePort,
    })
    const result = await manager.start(baseSpec())
    if (result.kind !== "started") throw new Error("expected started")
    const owner = { parentSessionId: "parent-1", parentPauseSeq: 1, runRef: { kind: "task" as const, id: result.task_id } }
    await manager.pauseTask(result.task_id, owner)
    expect(await manager.resumePausedTask(result.task_id, { ...owner, resumeId: "resume-1", childSeqCutoff: 8 }))
      .toEqual({ otherHoldLive: true, childSeq: 9 })
    expect(manager.get(result.task_id)?.status).toBe("paused")
    expect(manager.concurrency?.leaseState(result.task_id, 0)).toBe("parked")
  })
})
