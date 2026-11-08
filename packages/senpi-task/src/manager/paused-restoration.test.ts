import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { AdmissionBarrier } from "../pause/admission-barrier"
import type { ChildPausePort, RunPauseOwner } from "../pause/ports"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { ManagedStartSpec } from "./types"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, makeHandle, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"

afterEach(cleanupProjects)

const ROOT = "parent-1"

class RestoringRunner extends FakeRunner {
  readonly resumed: string[] = []
  readonly restored = new Map<string, ReturnType<typeof makeHandle>>()
  resume(spec: ManagedStartSpec, sessionPath: string) {
    this.resumed.push(sessionPath)
    const fake = makeHandle(spec.taskId)
    this.restored.set(spec.taskId, fake)
    return Promise.resolve(fake.handle)
  }
}

function writeTranscript(store: TaskRecordStore, taskId: string): string {
  const directory = resolveChildSessionDir(join(store.stateDir, "children", taskId), taskId)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, "2026-10-21_child.jsonl")
  writeFileSync(path, '{"type":"session","id":"restored-session"}\n')
  return path
}

/** A child paused by one host, then the host is gone: the second manager is the restarted process. */
async function pausedThenRestarted(options: { readonly transcript: boolean; readonly paused?: boolean } = { transcript: true }) {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const first = new FakeRunner()
  const before = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(),
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
  if (options.paused !== false) await before.pauseTask(taskId, owner)
  const epoch = before.get(taskId)?.notification.run_epoch
  before.forget(taskId, { path: "park" })
  before.workpools.dispose()
  const sessionPath = options.transcript ? writeTranscript(store, taskId) : undefined

  const calls: string[] = []
  const runner = new RestoringRunner()
  const turn = Promise.withResolvers<{ readonly status: "completed"; readonly finalResponse: string }>()
  const childPausePort: ChildPausePort = {
    pauseForRun: async (child, asked) => {
      calls.push(`pause:${asked.parentSessionId}:${asked.parentPauseSeq}:${asked.runRef.kind}:${asked.runRef.id}`)
      expect(runner.restored.get(child.task_id)?.followUpCalls).toEqual([])
      return { childSeq: 5 }
    },
    resumeTurn: async (_child, request) => {
      calls.push(`resume:${request.childSeqCutoff}`)
      return { turnId: "restored-turn", outcome: turn.promise }
    },
    holdInput: async (_child, input) => {
      calls.push(`hold:${input.text}`)
      return { kind: "held", entryId: "held-1", duplicate: false }
    },
  }
  const barrier = new AdmissionBarrier()
  barrier.close(ROOT, 2)
  const after = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner }, childPausePort, hostPid: 424_242,
    // The first host ran in this test process; the restarted host must see it as gone.
    isProcessAlive: () => false,
  })
  return { store, taskId, owner, epoch, sessionPath, calls, runner, turn, barrier, manager: after }
}

describe("restoring a paused child after its host is gone", () => {
  test("#given a paused child with a transcript #when its run resumes #then it is restored from the transcript, re-held under the saved owner, then resumed", async () => {
    const h = await pausedThenRestarted()
    const credential = h.barrier.resume(ROOT, 2, "resume-1")
    try {
      const resumed = await h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: 5, resumeCredential: credential })
      expect(resumed).toEqual({ turnId: "restored-turn" })
      expect(h.runner.resumed).toEqual(h.sessionPath === undefined ? [] : [h.sessionPath])
      expect(h.runner.startedSpecs).toHaveLength(0)
      expect(h.calls).toEqual([`pause:${ROOT}:2:task:${h.taskId}`, "resume:5"])
      expect(h.manager.get(h.taskId)?.notification.run_epoch).toBe(h.epoch)
      const terminal = h.manager.waitFor(h.taskId)
      h.turn.resolve({ status: "completed", finalResponse: "restored work" })
      expect(await terminal).toMatchObject({ status: "completed", final_response: "restored work" })
    } finally { h.manager.workpools.dispose() }
  })

  test("#given a paused child after a restart #when guidance is held #then the child is restored under the saved owner and holds it without a turn", async () => {
    const h = await pausedThenRestarted()
    try {
      expect(await h.manager.holdTaskInput(h.taskId, { inputId: "guide-1", revision: 0, text: "use staging" }))
        .toEqual({ kind: "held", entryId: "held-1", duplicate: false })
      expect(h.calls).toEqual([`pause:${ROOT}:2:task:${h.taskId}`, "hold:use staging"])
      expect(h.manager.get(h.taskId)?.status).toBe("paused")
      expect(h.runner.startedSpecs).toHaveLength(0)
    } finally { h.manager.workpools.dispose() }
  })

  test("#given a paused child whose transcript is gone #when its run resumes #then nothing is redispatched and the loss is reported", async () => {
    const h = await pausedThenRestarted({ transcript: false })
    const credential = h.barrier.resume(ROOT, 2, "resume-1")
    try {
      await expect(h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: 5, resumeCredential: credential }))
        .rejects.toMatchObject({ code: "paused_child_lost" })
      expect(h.runner.resumed).toEqual([])
      expect(h.runner.startedSpecs).toHaveLength(0)
      expect(h.calls).toEqual([])
    } finally { h.manager.workpools.dispose() }
  })

  test("#given a running child whose host is gone #when its run is stopped and later resumed #then it is held without a child, restored under the Resume credential, and resumed", async () => {
    const h = await pausedThenRestarted({ transcript: true, paused: false })
    try {
      const ack = await h.manager.pauseTask(h.taskId, h.owner)
      if ("refused" in ack) throw new Error("a gone child cannot refuse its run hold")
      expect(h.manager.get(h.taskId)?.status).toBe("paused")
      expect(h.runner.resumed).toEqual([])
      const credential = h.barrier.resume(ROOT, 2, "resume-1")
      const resumed = await h.manager.resumePausedTask(h.taskId, { ...h.owner, resumeId: "resume-1", childSeqCutoff: ack.childSeq, resumeCredential: credential })
      expect(resumed).toEqual({ turnId: "restored-turn" })
      expect(h.runner.resumed).toEqual(h.sessionPath === undefined ? [] : [h.sessionPath])
      // The cutoff is the restored child's own answer to the re-hold, never the sequence recorded without a child.
      expect(h.calls).toEqual([`pause:${ROOT}:2:task:${h.taskId}`, "resume:5"])
    } finally { h.manager.workpools.dispose() }
  })
})
