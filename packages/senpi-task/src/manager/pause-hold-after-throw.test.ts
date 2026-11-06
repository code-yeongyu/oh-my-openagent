import { afterEach, expect, test } from "bun:test"
import { createTaskRecordStore } from "../store"
import type { ChildPausePort, ObservedHold } from "../pause/ports"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

function managerWith(port: ChildPausePort) {
  const cwd = tempProject()
  const runner = new FakeRunner()
  const manager = createTaskManager({
    cwd, store: createTaskRecordStore({ project_dir: cwd }), config: settings(), planner: categoryPlanner(),
    runners: { "in-process": runner, process: runner }, childPausePort: port,
  })
  return { manager, runner }
}

function portObserving(observe: () => ObservedHold | undefined, runner: () => FakeRunner, calls: string[]): ChildPausePort {
  return {
    pauseForRun: async child => {
      if (observe()?.held === true) runner().handles.get(child.task_id)?.settle({ status: "cancelled" })
      calls.push("pause")
      throw new Error("pause_for_run timed out after the child accepted it")
    },
    observeHold: async (_child, parentSessionId) => { calls.push(`observe:${parentSessionId}`); return observe() },
    resumeTurn: async (_child, request) => {
      calls.push(`resume:${request.childSeqCutoff}`)
      return { turnId: "resumed", outcome: Promise.resolve({ status: "completed", finalResponse: "resumed" }) }
    },
    holdInput: async () => ({ kind: "held", entryId: "held", duplicate: false }),
  }
}

test("delta M1: a pause that throws after the engine took the hold is acknowledged from the engine's live hold", async () => {
  const calls: string[] = []
  let runner: FakeRunner | undefined
  const h = managerWith(portObserving(() => ({ held: true, childSeq: 6 }), () => runner ?? new FakeRunner(), calls))
  runner = h.runner
  const started = await h.manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: started.task_id } }
  try {
    await expect(h.manager.pauseTask(started.task_id, owner)).resolves.toEqual({ childSeq: 6 })
    expect(calls).toEqual(["pause", "observe:parent-1"])
    expect(h.manager.get(started.task_id)?.status).toBe("paused")
    expect(h.manager.get(started.task_id)?.run_pause).toEqual({ parent_session_id: "parent-1", parent_pause_seq: 2, run_ref: owner.runRef })
  } finally { await h.manager.cancelTask(started.task_id) }
})

test("delta M1: a pause that throws with no live hold still fails, so the run can record the child as lost", async () => {
  const calls: string[] = []
  let runner: FakeRunner | undefined
  const h = managerWith(portObserving(() => ({ held: false, childSeq: 6 }), () => runner ?? new FakeRunner(), calls))
  runner = h.runner
  const started = await h.manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: started.task_id } }
  try {
    await expect(h.manager.pauseTask(started.task_id, owner)).rejects.toThrow("timed out")
    expect(calls).toEqual(["pause", "observe:parent-1"])
  } finally { await h.manager.cancelTask(started.task_id) }
})

test("delta M1: a child the run lost but the engine still holds is released on Resume and its turn is tracked", async () => {
  const calls: string[] = []
  let held = false
  let runner: FakeRunner | undefined
  const h = managerWith(portObserving(() => ({ held, childSeq: 9 }), () => runner ?? new FakeRunner(), calls))
  runner = h.runner
  const started = await h.manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: started.task_id } }
  try {
    await expect(h.manager.pauseTask(started.task_id, owner)).rejects.toThrow()
    held = true
    const terminal = h.manager.waitFor(started.task_id)
    await expect(h.manager.resumeLostTask(started.task_id, { ...owner, resumeId: "resume-1" })).resolves.toEqual({ turnId: "resumed" })
    expect(calls.at(-1)).toBe("resume:9")
    expect(await terminal).toMatchObject({ status: "completed", final_response: "resumed" })
  } finally { await h.manager.cancelTask(started.task_id) }
})

test("delta M1: a lost child with no live hold is left alone on Resume", async () => {
  const calls: string[] = []
  let runner: FakeRunner | undefined
  const h = managerWith(portObserving(() => ({ held: false, childSeq: 9 }), () => runner ?? new FakeRunner(), calls))
  runner = h.runner
  const started = await h.manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected started")
  const owner = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: { kind: "task" as const, id: started.task_id } }
  try {
    await expect(h.manager.resumeLostTask(started.task_id, { ...owner, resumeId: "resume-1" })).resolves.toEqual({ notHeld: true })
    expect(calls.filter(call => call.startsWith("resume:"))).toEqual([])
  } finally { await h.manager.cancelTask(started.task_id) }
})
