import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cleanupProjects, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { NativeResumeRefusedError } from "../../../../senpi-task/src/pause/native-child-pause"
import type { EnginePauseState, ObservedHold } from "../../../../senpi-task/src/pause/ports"
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
const stopped = (pauseSeq: number): EnginePauseState => ({
  pauseSeq,
  holds: [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }],
})
const released = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [] })
const child: PauseParticipant = {
  key: "st_b",
  kind: "task",
  taskId: "st_b",
  runEpoch: 0,
  runRef: { kind: "task", id: "st_b" },
  state: "pending",
  at: "2026-01-01T00:00:00.000Z",
}
const queued: PauseParticipant = {
  key: "st_q",
  kind: "held_admission",
  taskId: "st_q",
  runRef: { kind: "task", id: "st_q" },
  state: "pending",
  at: "2026-01-01T00:00:00.000Z",
}

function hostOver(participants: readonly PauseParticipant[], overrides: Partial<RunPauseEffects>) {
  const root = mkdtempSync(join(tmpdir(), "run-pause-resume-failure-"))
  roots.push(root)
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(root, barrier)
  const resumed: string[] = []
  const effects: RunPauseEffects = {
    snapshot: () => participants,
    quiesce: () => undefined,
    addFences: async () => undefined,
    pause: async () => ({ kind: "held", childSeq: 8 }),
    dispatchGuidance: async () => undefined,
    resume: async (participant) => {
      resumed.push(participant.key)
      return { kind: "resumed" }
    },
    install: async () => undefined,
    acknowledgeInstalled: async () => undefined,
    cancel: async () => undefined,
    ...overrides,
  }
  let live: EnginePauseState = stopped(7)
  const notices: { parent: string; text: string }[] = []
  const bridge = new EngineRunPauseBridge(new RunPauseController(registry, effects), {
    getPauseState: () => live,
    notifyResumeFailure: (parent: string, text: string) => notices.push({ parent, text }),
  })
  return {
    barrier,
    registry,
    bridge,
    resumed,
    notices,
    setState: (next: EnginePauseState) => {
      live = next
    },
  }
}

test("Resume reports multiple failures once, reopens admission, and retries only the failed participants", async () => {
  let observed: ObservedHold = { held: false, childSeq: 0 }
  let resumeFails = true
  const resumed: string[] = []
  const other = { ...child, key: "st_c", taskId: "st_c" }
  const h = hostOver([child, other, queued], {
    pause: async (participant) => {
      if (participant.key === child.key) throw new Error("pause_for_run timed out")
      return { kind: "held", childSeq: 8 }
    },
    observeHold: async () => observed,
    resume: async (participant) => {
      if (resumeFails && participant.key === child.key) throw new Error("resume_for_run timed out at /private/secret")
      if (resumeFails && participant.key === other.key) throw new NativeResumeRefusedError("st_c", "stale")
      resumed.push(participant.key)
      return { kind: "resumed", turnId: "turn-b" }
    },
  })
  await h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("lost")
  observed = { held: true, childSeq: 9 }
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
  expect(h.registry.require(PARENT).phase).toBe("resumed")
  expect(h.registry.require(PARENT).participants.st_b).toMatchObject({ state: "lost" })
  expect(h.registry.require(PARENT).participants.st_b?.lostReason).toContain("resume_for_run timed out")
  expect(resumed).toEqual(["st_q"])
  expect(h.notices).toEqual([{ parent: PARENT, text: expect.stringContaining("2 participants") }])
  expect(h.notices[0]?.text).toContain("native_resume_refused")
  expect(h.notices[0]?.text).not.toContain("/private/secret")

  const resumeId = h.registry.require(PARENT).resume?.resumeId
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.notices).toHaveLength(1)

  resumeFails = false
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(resumed).toEqual(["st_q", "st_b", "st_c"])
  expect(h.registry.require(PARENT).resume?.resumeId).toBe(resumeId)
  expect(h.notices).toHaveLength(1)
  expect(h.registry.require(PARENT).participants.st_b?.state).toBe("resumed")
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
})

test("delta-2 HIGH: the Resume caller's result names each participant whose resume failed", async () => {
  const root = mkdtempSync(join(tmpdir(), "run-pause-resume-result-"))
  roots.push(root)
  const registry = new PauseRegistry(root, new AdmissionBarrier())
  const controller = new RunPauseController(registry, {
    snapshot: () => [child],
    quiesce: () => undefined,
    addFences: async () => undefined,
    pause: async () => {
      throw new Error("pause_for_run timed out")
    },
    observeHold: async () => ({ held: true, childSeq: 9 }),
    dispatchGuidance: async () => undefined,
    resume: async () => {
      throw new Error("resume_for_run timed out")
    },
    install: async () => undefined,
    acknowledgeInstalled: async () => undefined,
    cancel: async () => undefined,
  })
  await controller.pause(PARENT, 7)
  registry.update(PARENT, 7, "st_b", { state: "lost", lostReason: "pause_for_run timed out" })
  const result = await controller.resume(PARENT, 7, "resume-1")
  expect(result.kind).toBe("installed")
  expect(result.failures).toEqual([
    { key: "st_b", reason: expect.stringContaining("resume_for_run timed out"), code: "resume_failed" },
  ])
  expect(controller.released(PARENT, 7, "resume-1")).toBe(true)
})

test("delta-2 MEDIUM: a queued admission lost to a failed propagation is still re-admitted by Resume", async () => {
  const h = hostOver([queued], {
    addFences: async () => {
      throw new Error("fence write failed")
    },
    observeHold: async () => undefined,
  })
  await expect(h.bridge.changed(PARENT, { ...stopped(7), change: "paused" })).rejects.toThrow("fence write failed")
  h.setState(released(7))
  await h.bridge.changed(PARENT, { ...released(7), change: "resumed" })
  expect(h.resumed).toEqual(["st_q"])
  expect(h.barrier.state(PARENT)).toEqual({ kind: "open" })
  expect(h.notices).toEqual([])
})

test("delta-2 MEDIUM: the engine effect re-admits a lost queued admission through the admission port, never the lost-child path", async () => {
  const admitted: string[] = []
  const lostResumes: string[] = []
  const manager = {
    list: () => [],
    get: () => undefined,
    observeTaskHold: async () => undefined,
    resumeLostTask: async (taskId: string) => {
      lostResumes.push(taskId)
      return { notHeld: true }
    },
  } as unknown as Parameters<typeof createEngineRunPause>[0]["manager"]
  const barrier = new AdmissionBarrier()
  const graph = createEngineRunPause({
    stateDir: tempProject(),
    barrier,
    manager,
    runtime: { getPauseState: () => released(7), fenceRun: () => undefined },
    resumeAdmission: async (participant) => {
      admitted.push(participant.key)
      return { kind: "resumed" }
    },
  })
  graph.registry.begin(PARENT, 7, [{ ...queued, state: "lost", lostReason: "the Stop's propagation failed" }])
  graph.registry.phase(PARENT, 7, "applied")
  await expect(graph.controller.resume(PARENT, 7, "resume-1")).resolves.toEqual({ kind: "installed" })
  expect(admitted).toEqual(["st_q"])
  expect(lostResumes).toEqual([])
})
