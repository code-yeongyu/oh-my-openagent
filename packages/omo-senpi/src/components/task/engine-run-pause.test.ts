import { afterEach, expect, test } from "bun:test"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import type { RunnerOutcome } from "../../../../senpi-task/src/manager/child-handle"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createEngineRunPause } from "./engine-run-pause"
import { remainingTestTime } from "../../../../../test-support/test-deadline"

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

// A Resume the bridge never acted on (an older build's #12249 seq mismatch) leaves the Stop applied with
// no engine Stop left to release, so every later spawn reads "held by your Stop". The next turn releases it,
// and only when the engine's live ledger proves the recorded Stop was released.
// The engine ledger releasing exactly at the recorded Stop's seq proves the release as much as one past it.
for (const [where, releasedSeq] of [["at", 7], ["past", 8]] as const) test(`a Stop whose Resume the bridge missed is released by releaseStale once the engine holds no Stop ${where} its seq`, async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const manager = createTaskManager({
    cwd, store, config: settings({ provider_concurrency: { anthropic: 1 } }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async child => { runner.handles.get(child.task_id)?.settle({ status: "cancelled" }); return { childSeq: 8 } },
      resumeTurn: async () => ({ turnId: "fresh-turn", outcome: turn.promise }),
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const pause = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: {
      getPauseState: () => state,
      fenceRun: ref => { state = { pauseSeq: state.pauseSeq + 1, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}` }] } },
    },
  })
  try {
    await pause.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    expect(manager.get(started.task_id)?.status).toBe("paused")

    // The Stop is still live, and an engine ledger older than the recorded Stop proves nothing.
    await pause.bridge.releaseStale("parent")
    state = { pauseSeq: 6, holds: [] }
    await pause.bridge.releaseStale("parent")
    expect(manager.get(started.task_id)?.status).toBe("paused")
    expect(barrier.state("parent").kind).toBe("closed")

    // The engine released the Stop but the bridge never saw the Resume.
    state = { pauseSeq: releasedSeq, holds: [] }
    expect(await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))).toMatchObject({ kind: "held" })
    await pause.bridge.releaseStale("parent")
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(pause.registry.require("parent").phase).toBe("resumed")
    expect(barrier.state("parent").kind).toBe("open")
    turn.resolve({ status: "completed", finalResponse: "resumed" })
    expect((await manager.waitFor(started.task_id)).status).toBe("completed")
  } finally { turn.resolve({ status: "cancelled" }); await manager.cancelTask(started.task_id) }
})

// The ordinary Stop-then-message path: the engine's release already started a Resume through changed(), and
// the turn that message starts calls releaseStale. It must not join that Resume (a child's resume turn can
// take as long as the child's own pre-prompt work), so it returns at once and starts no second child resume.
test("releaseStale returns at once while a Resume is in flight and starts no second child resume", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const reached = Promise.withResolvers<void>()
  const answer = Promise.withResolvers<{ turnId: string; outcome: Promise<RunnerOutcome> }>()
  let resumeCalls = 0
  const manager = createTaskManager({
    cwd, store, config: settings({ provider_concurrency: { anthropic: 1 } }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async child => { runner.handles.get(child.task_id)?.settle({ status: "cancelled" }); return { childSeq: 8 } },
      // The child's resume does not answer until the test releases it.
      resumeTurn: () => { resumeCalls++; reached.resolve(); return answer.promise },
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const pause = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: {
      getPauseState: () => state,
      fenceRun: ref => { state = { pauseSeq: state.pauseSeq + 1, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}` }] } },
    },
  })
  let breaker: ReturnType<typeof setTimeout> | undefined
  try {
    await pause.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    state = { pauseSeq: 8, holds: [] }
    const resuming = pause.bridge.changed("parent", { ...state, change: "resumed" })
    await reached.promise

    // Circuit breaker only: a releaseStale that joined the in-flight Resume would never return here.
    const outcome = await Promise.race([
      pause.bridge.releaseStale("parent").then(() => "returned" as const),
      new Promise<"releaseStale still blocked at the end of the test budget">(resolve => { breaker = setTimeout(() => resolve("releaseStale still blocked at the end of the test budget"), remainingTestTime()) }),
    ])
    expect(outcome).toBe("returned")
    expect(resumeCalls).toBe(1)

    answer.resolve({ turnId: "fresh-turn", outcome: turn.promise })
    await resuming
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(barrier.state("parent").kind).toBe("open")
    expect(resumeCalls).toBe(1)
    turn.resolve({ status: "completed", finalResponse: "resumed" })
    expect((await manager.waitFor(started.task_id)).status).toBe("completed")
  } finally {
    clearTimeout(breaker)
    answer.resolve({ turnId: "fresh-turn", outcome: turn.promise })
    turn.resolve({ status: "cancelled" })
    await manager.cancelTask(started.task_id)
  }
})

// The same wedged ledger is released by a session restart: restore() adopts the engine's newer seq and
// the reconcile resumes it, because the engine holds no Stop at that seq.
test("a restart reconcile releases a Stop whose Resume the bridge missed", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const manager = createTaskManager({
    cwd, store, config: settings({ provider_concurrency: { anthropic: 1 } }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async child => { runner.handles.get(child.task_id)?.settle({ status: "cancelled" }); return { childSeq: 8 } },
      resumeTurn: async () => ({ turnId: "fresh-turn", outcome: turn.promise }),
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const runtime = {
    getPauseState: () => state,
    fenceRun: (ref: { kind: string; id: string }) => { state = { pauseSeq: state.pauseSeq + 1, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}` }] } },
  }
  const before = createEngineRunPause({ stateDir: store.stateDir, manager, barrier, runtime })
  try {
    await before.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    state = { pauseSeq: 8, holds: [] }
    const after = createEngineRunPause({ stateDir: store.stateDir, manager, barrier, runtime })
    await after.bridge.restore("parent")
    await after.bridge.reconciled("parent")
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(barrier.state("parent").kind).toBe("open")
    turn.resolve({ status: "completed", finalResponse: "resumed" })
    expect((await manager.waitFor(started.task_id)).status).toBe("completed")
  } finally { turn.resolve({ status: "cancelled" }); await manager.cancelTask(started.task_id) }
})

// #12249: the engine's run fences are holds, so each bumps its pauseSeq past the Stop's, and the
// Resume event carries the bumped seq. The run's Resume must still reach the child it paused.
test("a Resume whose engine seq counts the Stop's run fences resumes the paused child", async () => {
  const cwd = tempProject()
  const store = createTaskRecordStore({ project_dir: cwd })
  const barrier = new AdmissionBarrier()
  const runner = new FakeRunner()
  const turn = Promise.withResolvers<RunnerOutcome>()
  const owners: number[] = []
  const manager = createTaskManager({
    cwd, store, config: settings({ provider_concurrency: { anthropic: 1 } }), planner: categoryPlanner(), admissionBarrier: barrier,
    runners: { "in-process": runner, process: runner },
    childPausePort: {
      pauseForRun: async (child, owner) => {
        owners.push(owner.parentPauseSeq)
        runner.handles.get(child.task_id)?.settle({ status: "cancelled" })
        return { childSeq: 8 }
      },
      resumeTurn: async (_child, request) => {
        owners.push(request.parentPauseSeq)
        return { turnId: "fresh-turn", outcome: turn.promise }
      },
      holdInput: async () => ({ kind: "held", entryId: "guidance", duplicate: false }),
    },
  })
  const started = await manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))
  if (started.kind !== "started") throw new Error("expected started")
  let state: EnginePauseState = { pauseSeq: 7, holds: [{ kind: "session_hold", key: "session_hold:7" }] }
  const pause = createEngineRunPause({
    stateDir: store.stateDir, manager, barrier,
    runtime: {
      getPauseState: () => state,
      fenceRun: ref => { state = { pauseSeq: state.pauseSeq + 1, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}` }] } },
    },
  })
  try {
    await pause.bridge.changed("parent", { pauseSeq: 7, holds: state.holds, change: "paused" })
    expect(manager.get(started.task_id)?.status).toBe("paused")
    expect(state.pauseSeq).toBe(8)
    state = { pauseSeq: 8, holds: [] }
    await pause.bridge.changed("parent", { ...state, change: "resumed" })
    expect(manager.get(started.task_id)?.status).toBe("running")
    expect(owners).toEqual([7, 7])
    expect(barrier.state("parent").kind).toBe("open")
    turn.resolve({ status: "completed", finalResponse: "resumed" })
    expect((await manager.waitFor(started.task_id)).status).toBe("completed")
  } finally { turn.resolve({ status: "cancelled" }); await manager.cancelTask(started.task_id) }
})
