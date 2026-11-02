import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { PauseRegistry, type PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import { EngineRunPauseBridge } from "./run-pause-bridge"
import { createTaskRecordStore } from "../../../../senpi-task/src/store"
import { createTaskManager } from "../../../../senpi-task/src/manager/manager"
import { baseSpec, categoryPlanner, FakeRunner, settings } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const PARENT = "parent"
const stopped = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }] })
const released = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [] })

const nodeB: PauseParticipant = {
  key: "b", kind: "dag_node", taskId: "st_b", nodeId: "b", runEpoch: 0,
  runRef: { kind: "dag", id: "run-1" }, state: "pending", at: "2026-01-01T00:00:00.000Z",
}

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "run-pause-restart-"))
  roots.push(root)
  return root
}

// One host process over a shared state dir: a fresh barrier, registry, controller and bridge, as a restart builds them.
function hostProcess(root: string, options: {
  readonly state: EnginePauseState | undefined
  readonly participants?: readonly PauseParticipant[]
  readonly effects?: (registry: PauseRegistry) => Partial<RunPauseEffects>
}) {
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(root, barrier)
  const calls: string[] = []
  const resumed: string[] = []
  const paused: string[] = []
  const effects: RunPauseEffects = {
    snapshot: () => options.participants ?? [nodeB],
    quiesce: () => undefined,
    addFences: async () => undefined,
    pause: async (participant, owner) => { paused.push(`${participant.key}@${owner.parentPauseSeq}`); return { kind: "held", childSeq: 8 } },
    dispatchGuidance: async () => { calls.push("guidance") },
    resume: async participant => { resumed.push(participant.key); return { kind: "resumed", turnId: `turn-${participant.key}` } },
    install: async () => { calls.push("install") },
    acknowledgeInstalled: async (parent, pauseSeq, resumeId) => { registry.markInstalled(parent, pauseSeq, resumeId) },
    cancel: async () => undefined,
    ...options.effects?.(registry),
  }
  let live = options.state
  const controller = new RunPauseController(registry, effects)
  const bridge = new EngineRunPauseBridge(controller, { getPauseState: () => live })
  const restart = async () => { await bridge.restore(PARENT); await bridge.reconciled(PARENT) }
  return { barrier, registry, controller, bridge, calls, resumed, paused, restart, setState: (next: EnginePauseState) => { live = next } }
}

async function stopAndResume(host: ReturnType<typeof hostProcess>): Promise<void> {
  await host.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  host.setState(released(7))
  await host.bridge.changed(PARENT, { ...released(7), change: "resumed" })
}

test("design 19: with no registry written, a restart under the engine's Stop rebuilds custody before reconcile and resumes nothing", async () => {
  const root = stateRoot()
  const host = hostProcess(root, { state: stopped(7) })
  await host.bridge.restore(PARENT)
  expect(host.barrier.state(PARENT)).toEqual({ kind: "closed", pauseSeq: 7 })
  expect(host.registry.require(PARENT).participants.b?.state).toBe("pending")
  await host.bridge.reconciled(PARENT)
  expect(host.paused).toEqual(["b@7"])
  expect(host.registry.require(PARENT)).toMatchObject({ phase: "applied", participants: { b: { state: "held", ackSeq: 7 } } })
  expect(host.resumed).toEqual([])
  expect(host.calls).not.toContain("install")
})

test("design 20: a host killed after B resumed and before the scheduler installs finishes the Resume once without resuming B again", async () => {
  const root = stateRoot()
  const first = hostProcess(root, { state: stopped(7), effects: () => ({ install: async () => { throw new Error("host killed") } }) })
  await expect(stopAndResume(first)).rejects.toThrow("host killed")
  expect(first.resumed).toEqual(["b"])
  expect(first.registry.require(PARENT).participants.b?.state).toBe("resumed")

  const second = hostProcess(root, { state: released(7) })
  await second.restart()
  await second.bridge.reconciled(PARENT)
  expect(second.resumed).toEqual([])
  expect(second.calls.filter(call => call === "install")).toHaveLength(1)
  expect(second.barrier.state(PARENT)).toEqual({ kind: "open" })
  expect(second.registry.require(PARENT).phase).toBe("resumed")
})

test("design 23: a repeated Stop raises every participant to the new sequence and a Resume at the old one is refused", async () => {
  const nodeC: PauseParticipant = { ...nodeB, key: "c", taskId: "st_c", nodeId: "c" }
  const host = hostProcess(stateRoot(), { state: stopped(7), participants: [nodeB, nodeC] })
  await host.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  host.setState(stopped(8))
  await host.bridge.changed(PARENT, { ...stopped(8), change: "paused" })
  expect(host.paused).toEqual(["b@7", "c@7", "b@8", "c@8"])
  const record = host.registry.require(PARENT)
  expect(record.pauseSeq).toBe(8)
  expect(Object.values(record.participants).map(entry => [entry.key, entry.state, entry.ackSeq])).toEqual([["b", "held", 8], ["c", "held", 8]])
  await host.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  await expect(host.controller.resume(PARENT, 7, "late-resume")).rejects.toThrow("stale")
  expect(host.resumed).toEqual([])
  expect(host.barrier.state(PARENT)).toEqual({ kind: "closed", pauseSeq: 8 })
})

test("design 31: a restart while the engine still holds the Stop leaves held input alone and resumes nothing", async () => {
  const root = stateRoot()
  const first = hostProcess(root, { state: stopped(7) })
  await first.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  const second = hostProcess(root, { state: stopped(7) })
  await second.restart()
  expect(second.resumed).toEqual([])
  expect(second.calls).toEqual([])
  expect(second.barrier.state(PARENT)).toEqual({ kind: "closed", pauseSeq: 7 })
})

test("#given an acknowledged Stop persisted by the previous host #when human Resume cannot restore a held child #then admission reopens and the child stays retryable", async () => {
  const root = stateRoot()
  const first = hostProcess(root, { state: stopped(7) })
  await first.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  expect(first.registry.require(PARENT).participants.b?.state).toBe("held")

  let restoreFails = true
  const second = hostProcess(root, { state: stopped(7), effects: () => ({
    resume: async (_participant, request) => {
      expect(request.childSeqCutoff).toBe(8)
      if (restoreFails) throw new Error("paused child st_b restore failed (respawn_failed): runtime unavailable")
      return { kind: "resumed", turnId: "restored-turn" }
    },
  }) })
  const runner = new FakeRunner()
  const manager = createTaskManager({
    cwd: root, store: createTaskRecordStore({ project_dir: root, task: { state_dir: join(root, "task-records") } }), admissionBarrier: second.barrier,
    planner: categoryPlanner(), config: settings(), runners: { "in-process": runner, process: runner },
  })
  const input = baseSpec({ parent_session_id: PARENT, root_session_id: PARENT })
  await second.restart()
  expect(await manager.start(input)).toMatchObject({ kind: "held" })
  second.setState(released(7))
  await second.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  const admitted = await manager.start(input)
  expect(admitted.kind).toBe("started")
  if (admitted.kind === "started") await manager.cancelTask(admitted.task_id)
  expect(second.registry.require(PARENT)).toMatchObject({
    phase: "resumed", participants: { b: { state: "lost", lostReason: expect.stringContaining("respawn_failed") } },
  })

  restoreFails = false
  await second.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(second.registry.require(PARENT).participants.b).toMatchObject({ state: "resumed", resumeTurnId: "restored-turn" })
  expect(second.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("design 31: a restart after the Resume was requested completes it exactly once when the engine releases", async () => {
  const root = stateRoot()
  const first = hostProcess(root, { state: stopped(7), effects: () => ({ dispatchGuidance: async () => { throw new Error("host killed") } }) })
  await expect(stopAndResume(first)).rejects.toThrow("host killed")
  const resumeId = first.registry.require(PARENT).resume?.resumeId
  expect(resumeId).toBeDefined()

  const second = hostProcess(root, { state: stopped(7) })
  await second.restart()
  expect(second.resumed).toEqual([])
  second.setState(released(7))
  await second.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  await second.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(second.registry.require(PARENT).resume?.resumeId).toBe(resumeId)
  expect(second.resumed).toEqual(["b"])
  expect(second.calls.filter(call => call === "install")).toHaveLength(1)
  expect(second.barrier.state(PARENT)).toEqual({ kind: "open" })
})

const crashPoints: readonly {
  readonly phase: string
  readonly effects?: (registry: PauseRegistry) => Partial<RunPauseEffects>
  readonly crashes: boolean
  readonly resumedAfterRestart: readonly string[]
  readonly installsAfterRestart: number
}[] = [
  { phase: "engine requested, registry still applied", crashes: false, resumedAfterRestart: ["b"], installsAfterRestart: 1 },
  { phase: "requested", crashes: true, resumedAfterRestart: ["b"], installsAfterRestart: 1,
    effects: () => ({ dispatchGuidance: async () => { throw new Error("host killed") } }) },
  { phase: "run_installed", crashes: true, resumedAfterRestart: [], installsAfterRestart: 1,
    effects: registry => ({ acknowledgeInstalled: async (parent, pauseSeq, resumeId) => {
      registry.markInstalled(parent, pauseSeq, resumeId)
      throw new Error("host killed")
    } }) },
  { phase: "released", crashes: false, resumedAfterRestart: [], installsAfterRestart: 0 },
]

for (const point of crashPoints) {
  test(`design 33: a crash at ${point.phase} finishes the Resume exactly once after restart`, async () => {
    const root = stateRoot()
    const first = hostProcess(root, { state: stopped(7), ...(point.effects === undefined ? {} : { effects: point.effects }) })
    if (point.phase === "engine requested, registry still applied") {
      await first.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
    } else if (point.crashes) {
      await expect(stopAndResume(first)).rejects.toThrow("host killed")
    } else {
      await stopAndResume(first)
      expect(first.barrier.state(PARENT)).toEqual({ kind: "open" })
    }

    const second = hostProcess(root, { state: released(7) })
    await second.restart()
    await second.bridge.reconciled(PARENT)
    expect(second.resumed).toEqual([...point.resumedAfterRestart])
    expect(second.calls.filter(call => call === "install")).toHaveLength(point.installsAfterRestart)
    expect(second.barrier.state(PARENT)).toEqual({ kind: "open" })
    expect(second.registry.require(PARENT).phase).toBe("resumed")
  })
}

test("design 36: after a restart the Resume takes parked capacity first, then queued admissions in persisted sequence", async () => {
  const at = "2026-01-01T00:00:00.000Z"
  const participants: readonly PauseParticipant[] = [
    { key: "queued-early", kind: "held_admission", runRef: { kind: "task", id: "queued-early" }, state: "pending", at,
      admission: { model: "m", laneKey: "m", sequence: 0, phase: "pre_grant" } },
    { key: "parked-late", kind: "task", taskId: "parked-late", runEpoch: 0, runRef: { kind: "task", id: "parked-late" }, state: "pending", at,
      admission: { model: "m", laneKey: "m", sequence: 4, phase: "parked" } },
    { key: "queued-late", kind: "held_admission", runRef: { kind: "task", id: "queued-late" }, state: "pending", at,
      admission: { model: "m", laneKey: "m", sequence: 2, phase: "pre_grant" } },
    { key: "parked-early", kind: "task", taskId: "parked-early", runEpoch: 0, runRef: { kind: "task", id: "parked-early" }, state: "pending", at,
      admission: { model: "m", laneKey: "m", sequence: 1, phase: "parked" } },
  ]
  const root = stateRoot()
  const first = hostProcess(root, { state: stopped(7), participants })
  await first.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  const second = hostProcess(root, { state: released(7), participants })
  await second.restart()
  expect(second.resumed).toEqual(["parked-early", "parked-late", "queued-early", "queued-late"])
})
