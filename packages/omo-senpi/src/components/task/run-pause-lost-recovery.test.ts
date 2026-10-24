import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState, ObservedHold } from "../../../../senpi-task/src/pause/ports"
import { PauseRegistry, type PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import { EngineRunPauseBridge } from "./run-pause-bridge"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const PARENT = "parent"
const stopped = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }] })
const released = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [] })
const child: PauseParticipant = {
  key: "st_b", kind: "task", taskId: "st_b", runEpoch: 0, runRef: { kind: "task", id: "st_b" },
  state: "pending", at: "2026-01-01T00:00:00.000Z",
}

function hostOver(overrides: Partial<RunPauseEffects>) {
  const root = mkdtempSync(join(tmpdir(), "run-pause-lost-"))
  roots.push(root)
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(root, barrier)
  const resumed: { readonly key: string; readonly cutoff?: number; readonly state: string }[] = []
  const effects: RunPauseEffects = {
    snapshot: () => [child],
    quiesce: () => undefined,
    addFences: async () => undefined,
    pause: async () => { throw new Error("pause_for_run timed out") },
    dispatchGuidance: async () => undefined,
    resume: async (participant, request) => {
      resumed.push({ key: participant.key, state: participant.state, ...(request.childSeqCutoff === undefined ? {} : { cutoff: request.childSeqCutoff }) })
      return { kind: "resumed", turnId: "turn-b" }
    },
    install: async () => undefined,
    acknowledgeInstalled: async () => undefined,
    cancel: async () => undefined,
    ...overrides,
  }
  let live: EnginePauseState = stopped(7)
  const bridge = new EngineRunPauseBridge(new RunPauseController(registry, effects), { getPauseState: () => live })
  return { barrier, registry, bridge, resumed, setState: (next: EnginePauseState) => { live = next } }
}

async function stopThenResume(h: ReturnType<typeof hostOver>): Promise<void> {
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
}

test("delta M1: a child whose pause throws but whose engine holds it is recorded held, never lost, and resumed with its cutoff", async () => {
  const h = hostOver({ observeHold: async (): Promise<ObservedHold> => ({ held: true, childSeq: 8 }) })
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  expect(h.registry.require(PARENT).participants.st_b).toMatchObject({ state: "held", observedChildSeq: 8, ackSeq: 7 })
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.resumed).toEqual([{ key: "st_b", state: "held", cutoff: 8 }])
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("delta M1: a lost child that holds again by Resume is resumed with its observed cutoff, not skipped", async () => {
  let observed: ObservedHold = { held: false, childSeq: 0 }
  const h = hostOver({ observeHold: async () => observed })
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("lost")
  observed = { held: true, childSeq: 9 }
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.resumed).toEqual([{ key: "st_b", state: "lost", cutoff: 9 }])
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("resumed")
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("delta M1: a lost child with no live hold at Resume is left alone and admission still reopens", async () => {
  const h = hostOver({ observeHold: async () => ({ held: false, childSeq: 0 }) })
  await stopThenResume(h)
  expect(h.resumed).toEqual([])
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("lost")
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("delta LOW: a propagation failure Resume runs past is recorded as the lost child's reason, never discarded", async () => {
  const h = hostOver({
    pause: async () => ({ kind: "held", childSeq: 8 }),
    addFences: async () => { throw new Error("fence write failed") },
    observeHold: async () => ({ held: false, childSeq: 0 }),
  })
  await expect(h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })).rejects.toThrow("fence write failed")
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
  expect(h.registry.require(PARENT).participants.st_b).toMatchObject({ state: "lost" })
  expect(h.registry.require(PARENT).participants.st_b?.lostReason).toContain("fence write failed")
  expect(h.resumed).toEqual([])
})
