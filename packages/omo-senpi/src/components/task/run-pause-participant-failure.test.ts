import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupProjects, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { NativePauseUnavailableError } from "../../../../senpi-task/src/pause/native-child-pause"
import type { EngineInheritReceipt, EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { PauseRegistry, type PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import { createEngineRunPause } from "./engine-run-pause"
import { EngineRunPauseBridge } from "./run-pause-bridge"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  cleanupProjects()
})

const PARENT = "parent"
const stopped = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }] })
const released = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [] })
const child: PauseParticipant = {
  key: "st_b", kind: "task", taskId: "st_b", runEpoch: 0, runRef: { kind: "task", id: "st_b" },
  state: "pending", at: "2026-01-01T00:00:00.000Z",
}

function bridgeOver(root: string, pause: RunPauseEffects["pause"], state: EnginePauseState) {
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(root, barrier)
  const resumed: string[] = []
  const effects: RunPauseEffects = {
    snapshot: () => [child],
    quiesce: () => undefined,
    addFences: async () => undefined,
    pause,
    dispatchGuidance: async () => undefined,
    resume: async participant => { resumed.push(participant.key); return { kind: "resumed" } },
    install: async () => undefined,
    acknowledgeInstalled: async () => undefined,
    cancel: async () => undefined,
  }
  let live = state
  const bridge = new EngineRunPauseBridge(new RunPauseController(registry, effects), { getPauseState: () => live })
  return { barrier, registry, bridge, resumed, setState: (next: EnginePauseState) => { live = next } }
}

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "run-pause-failure-"))
  roots.push(root)
  return root
}

async function stopThenResume(h: ReturnType<typeof bridgeOver>): Promise<void> {
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
}

test("H2: a participant that never acknowledges the pause is recorded lost and Resume still reopens admission", async () => {
  const h = bridgeOver(stateRoot(), async () => ({ kind: "pending" }), stopped(7))
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  expect(h.registry.require(PARENT).phase).toBe("applied")
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("lost")
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.resumed).toEqual([])
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("H2: a participant whose pause throws is recorded lost and Resume still reopens admission", async () => {
  const h = bridgeOver(stateRoot(), async () => { throw new Error("child transport lost") }, stopped(7))
  await stopThenResume(h)
  expect(h.resumed).toEqual([])
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("H2: after a restart from a registry left propagating, a released engine reopens admission", async () => {
  const root = stateRoot()
  new PauseRegistry(root, new AdmissionBarrier()).begin(PARENT, 7, [child])
  const h = bridgeOver(root, async () => { throw new Error("child gone after restart") }, stopped(7))
  await h.bridge.restore(PARENT)
  await h.bridge.reconciled(PARENT)
  expect(h.registry.require(PARENT).phase).toBe("applied")
  expect(h.barrier.state(PARENT)).toEqual({ kind: "closed", pauseSeq: 7 })
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

function engineGraph(pauseTask: () => Promise<EngineInheritReceipt>) {
  const record = {
    task_id: "st_b", status: "running", parent_session_id: PARENT, created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", notification: { run_epoch: 0 },
  }
  const manager = {
    list: () => [{ record }],
    get: (taskId: string) => taskId === "st_b" ? record : undefined,
    pauseTask,
    resumePausedTask: async () => { throw new Error("a child the run never held is not resumed") },
  } as unknown as Parameters<typeof createEngineRunPause>[0]["manager"]
  let live: EnginePauseState = stopped(7)
  const barrier = new AdmissionBarrier()
  const graph = createEngineRunPause({
    stateDir: tempProject(), barrier, manager, runtime: { getPauseState: () => live, fenceRun: () => undefined },
  })
  return { graph, barrier, setState: (next: EnginePauseState) => { live = next } }
}

for (const [name, pauseTask] of [
  ["refuses the parent with a receipt", async (): Promise<EngineInheritReceipt> => ({ refused: "wrong_parent" })],
  ["runs on an engine without a run hold", async (): Promise<EngineInheritReceipt> => { throw new NativePauseUnavailableError("st_b") }],
] as const) {
  test(`H2: when a child ${name}, Stop still applies and Resume or a person's message reopens admission`, async () => {
    const h = engineGraph(pauseTask)
    await h.graph.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
    const record = h.graph.registry.require(PARENT)
    expect(record.phase).toBe("applied")
    expect(record.participants.st_b === undefined || record.participants.st_b.state === "lost").toBe(true)
    h.setState(released(7))
    await h.graph.bridge.changed(PARENT, { ...released(7), change: "resumed" })
    expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
  })
}
