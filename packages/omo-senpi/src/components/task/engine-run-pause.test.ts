import { afterEach, expect, test } from "bun:test"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import type { RunnerOutcome } from "../../../../senpi-task/src/manager/child-handle"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createEngineRunPause } from "./engine-run-pause"

afterEach(cleanupProjects)

test("a real task manager pauses nonterminally, resumes the same child and installs run sources before admission reopens", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const calls: string[] = []
  const manager = createTaskManager({
    cwd, store, config: settings({ provider_concurrency: { anthropic: 1 } }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async child => { runner.handles.get(child.task_id)?.settle({ status: "cancelled" }); return { childSeq: 8 } },
      resumeTurn: async (_child, request) => {
        expect(request.childSeqCutoff).toBe(8)
        calls.push("child-resume")
        return { turnId: "fresh-turn", outcome: turn.promise }
      },
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const fences: string[] = []
  const pause = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: { getPauseState: () => state, fenceRun: ref => { fences.push(`${ref.kind}:${ref.id}`) } },
  })
  const unregister = pause.register({
    refs: () => [{ kind: "dag", id: "workflow" }],
    quiesce: () => { calls.push("quiesce") },
    dispatchGuidance: async () => { calls.push("guidance") },
    install: async () => { calls.push("install"); expect(barrier.state("parent").kind).toBe("resuming") },
  })
  try {
    await pause.bridge.changed("parent", { ...state, change: "paused" })
    expect(manager.get(started.task_id)?.status).toBe("paused")
    expect(manager.get(started.task_id)?.notification.run_epoch).toBe(0)
    expect(pause.registry.require("parent").participants[started.task_id]?.admission).toEqual({
      model: "anthropic/claude", laneKey: "anthropic", sequence: 0, phase: "parked",
    })
    expect(fences).toContain(`task:${started.task_id}`)
    expect(fences).toContain("dag:workflow")
    expect(await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))).toMatchObject({ kind: "held" })
    state = { pauseSeq: 7, holds: [] }
    await pause.bridge.changed("parent", { ...state, change: "resumed" })
    expect(calls).toEqual(["quiesce", "guidance", "child-resume", "install"])
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(runner.startedSpecs).toHaveLength(1)
    expect(pause.registry.require("parent").resume?.installed).toBe(true)
    expect(barrier.state("parent").kind).toBe("open")
    turn.resolve({ status: "completed", finalResponse: "resumed" })
    expect((await manager.waitFor(started.task_id)).status).toBe("completed")
  } finally { unregister(); turn.resolve({ status: "cancelled" }); await manager.cancelTask(started.task_id) }
})
