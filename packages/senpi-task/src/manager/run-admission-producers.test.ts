import { afterEach, describe, expect, test } from "bun:test"
import { AdmissionBarrier } from "../pause/admission-barrier"
import type { ChildPausePort, RunPauseOwner } from "../pause/ports"
import { createTaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, launchSettled, settings, tempProject } from "./__fixtures__/manager-fakes"

afterEach(cleanupProjects)

const ROOT = "parent-1"

function harness() {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const runner = new FakeRunner()
  const barrier = new AdmissionBarrier()
  const paused: RunPauseOwner[] = []
  const held: { readonly taskId: string; readonly text: string }[] = []
  const noted: string[] = []
  const childPausePort: ChildPausePort = {
    pauseForRun: async (child, owner) => {
      paused.push(owner)
      runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
      return { childSeq: 5 }
    },
    resumeTurn: async () => { throw new Error("no Resume in this test") },
    holdInput: async (child, input) => {
      held.push({ taskId: child.task_id, text: input.text })
      return { kind: "held", entryId: `entry-${held.length}`, duplicate: false }
    },
  }
  const manager = createTaskManager({
    cwd, store, config: settings({ default_concurrency: 5 }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner }, childPausePort,
    onPausedChild: record => { noted.push(record.task_id) },
  })
  const start = async () => {
    const started = await manager.start(baseSpec({ run_in_background: true }))
    if (started.kind !== "started") throw new Error(`unexpected start: ${started.kind}`)
    await launchSettled(manager, started.task_id)
    return started.task_id
  }
  return { manager, runner, barrier, paused, held, noted, start }
}

describe("live sends under a closed run admission", () => {
  test("#given a paused child #when a message is sent while the run is stopped #then it is held in the child and no turn starts", async () => {
    const h = harness()
    const taskId = await h.start()
    const owner = { parentSessionId: ROOT, parentPauseSeq: 3, runRef: { kind: "task" as const, id: taskId } }
    await h.manager.pauseTask(taskId, owner)
    h.barrier.close(ROOT, 3)
    const sent = await h.manager.sendToTask({ idOrName: taskId, message: "use staging", callerSessionId: ROOT })
    expect(sent).toMatchObject({ kind: "held", task_id: taskId, pause_seq: 3, entry_id: "entry-1" })
    expect(h.held).toEqual([{ taskId, text: "use staging" }])
    expect(h.runner.handles.get(taskId)?.followUpCalls).toEqual([])
    expect(h.manager.get(taskId)?.status).toBe("paused")
  })

  for (const state of ["running", "completed"] as const) {
    test(`#given a ${state} child outside the paused set #when a message is sent while the run is stopped #then the child joins the pause and holds the input`, async () => {
      const h = harness()
      const taskId = await h.start()
      if (state === "completed") {
        const terminal = h.manager.waitFor(taskId)
        h.runner.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
        await terminal
      }
      h.barrier.close(ROOT, 4)
      const sent = await h.manager.sendToTask({ idOrName: taskId, message: "one more thing", callerSessionId: ROOT })
      expect(sent).toMatchObject({ kind: "held", task_id: taskId, pause_seq: 4 })
      expect(h.paused).toEqual([{ parentSessionId: ROOT, parentPauseSeq: 4, runRef: { kind: "task", id: taskId } }])
      expect(h.held).toEqual([{ taskId, text: "one more thing" }])
      expect(h.noted).toEqual([taskId])
      const handle = h.runner.handles.get(taskId)
      expect([...(handle?.followUpCalls ?? []), ...(handle?.steerCalls ?? [])]).toEqual([])
      expect(h.manager.get(taskId)?.status).toBe("paused")
    })
  }
})

describe("respawn under a closed run admission", () => {
  test("#given a stopped run #when a child respawns #then nothing launches until Resume authorizes it", async () => {
    const h = harness()
    const taskId = await h.start()
    const terminal = h.manager.waitFor(taskId)
    h.runner.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await terminal
    const record = h.manager.get(taskId)
    if (record === undefined) throw new Error("record missing")
    const launches = h.runner.startedSpecs.length
    h.barrier.close(ROOT, 6)
    expect(await h.manager.respawn(record)).toMatchObject({ ok: false, disposition: "retryable", code: "run_paused" })
    expect(h.runner.startedSpecs).toHaveLength(launches)
    const credential = h.barrier.resume(ROOT, 6, "resume-6")
    expect(await h.manager.respawn(record)).toMatchObject({ ok: false, code: "run_paused" })
    const authorized = await h.manager.respawn(record, undefined, credential)
    if (!authorized.ok) throw new Error(`Resume respawn refused: ${authorized.code}`)
    expect(h.runner.startedSpecs).toHaveLength(launches + 1)
    await authorized.handle.dispose()
  })
})
