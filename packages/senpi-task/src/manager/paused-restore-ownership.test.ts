import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { AdmissionBarrier } from "../pause/admission-barrier"
import type { ChildPausePort, RunPauseOwner } from "../pause/ports"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskRecordStore } from "../store"
import type { ManagedStartSpec } from "./types"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

const ROOT = "parent-1"
const FIRST_HOST = 31_337

class RestoringRunner extends FakeRunner {
  readonly resumed: string[] = []
  resume(spec: ManagedStartSpec, sessionPath: string) {
    this.resumed.push(sessionPath)
    return Promise.resolve(makeHandle(spec.taskId).handle)
  }
}

async function pausedOnAnotherHost(firstHostAlive: boolean) {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const first = new FakeRunner()
  const before = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(), hostPid: FIRST_HOST,
    runners: { "in-process": first, process: first },
    childPausePort: {
      pauseForRun: async child => {
        first.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 5 }
      },
      resumeTurn: async () => { throw new Error("the first host never resumes") },
      holdInput: async () => { throw new Error("the first host never holds input") },
    },
  })
  const started = await before.start(baseSpec({ run_in_background: true }))
  if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
  await launchSettled(before, started.task_id)
  const taskId = started.task_id
  const owner: RunPauseOwner = { parentSessionId: ROOT, parentPauseSeq: 2, runRef: { kind: "task", id: taskId } }
  await before.pauseTask(taskId, owner)
  before.forget(taskId, { path: "park" })
  before.workpools.dispose()
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "2026-10-21_child.jsonl"), '{"type":"session","id":"restored-session"}\n')

  const calls: string[] = []
  const runner = new RestoringRunner()
  const childPausePort: ChildPausePort = {
    pauseForRun: async () => { calls.push("pause"); return { childSeq: 5 } },
    resumeTurn: async () => { calls.push("resume"); return { turnId: "restored-turn", outcome: Promise.withResolvers<never>().promise } },
    holdInput: async () => { calls.push("hold"); return { kind: "held", entryId: "held-1", duplicate: false } },
  }
  const barrier = new AdmissionBarrier()
  barrier.close(ROOT, 2)
  const manager = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner }, childPausePort, hostPid: 424_242,
    isProcessAlive: pid => pid === FIRST_HOST && firstHostAlive,
  })
  return { store, taskId, owner, calls, runner, barrier, manager }
}

describe("restoring a paused child never takes it from a live host", () => {
  test("#given the recorded host is still alive #when its run resumes #then the restore is refused and the record keeps its owner", async () => {
    const h = await pausedOnAnotherHost(true)
    const credential = h.barrier.resume(ROOT, 2, "resume-1")
    try {
      await expect(h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: 5, resumeCredential: credential }))
        .rejects.toMatchObject({ code: "paused_child_owned_elsewhere" })
      expect(h.runner.resumed).toEqual([])
      expect(h.calls).toEqual([])
      expect(h.store.load(h.taskId)?.host_pid).toBe(FIRST_HOST)
    } finally { h.manager.workpools.dispose() }
  })

  test("#given the recorded host is still alive #when guidance is held #then the restore is refused without touching the child", async () => {
    const h = await pausedOnAnotherHost(true)
    try {
      await expect(h.manager.holdTaskInput(h.taskId, { inputId: "guide-1", revision: 0, text: "use staging" }))
        .rejects.toMatchObject({ code: "paused_child_owned_elsewhere" })
      expect(h.runner.resumed).toEqual([])
      expect(h.calls).toEqual([])
      expect(h.store.load(h.taskId)?.host_pid).toBe(FIRST_HOST)
    } finally { h.manager.workpools.dispose() }
  })

  test("#given the recorded host is gone #when guidance is held #then the child is restored under this host", async () => {
    const h = await pausedOnAnotherHost(false)
    try {
      expect(await h.manager.holdTaskInput(h.taskId, { inputId: "guide-1", revision: 0, text: "use staging" }))
        .toEqual({ kind: "held", entryId: "held-1", duplicate: false })
      expect(h.runner.resumed).toHaveLength(1)
      expect(h.calls).toEqual(["pause", "hold"])
      expect(h.store.load(h.taskId)?.host_pid).toBe(424_242)
    } finally { h.manager.workpools.dispose() }
  })
})
