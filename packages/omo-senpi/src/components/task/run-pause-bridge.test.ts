import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { PauseRegistry } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import type { EnginePauseState } from "../../../../senpi-task/src/pause/ports"
import { EngineRunPauseBridge } from "./run-pause-bridge"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine, type TaskEngine } from "./engine"
import { wireEventBridge } from "./event-bridge"
import { createSessionTransitionBridge } from "./session-transition-bridge"
import { baseSpec } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const held = (pauseSeq: number): EnginePauseState => ({ pauseSeq, holds: [{ kind: "session_hold", key: `session_hold:${pauseSeq}` }] })

function fixture(overrides: Partial<RunPauseEffects> = {}) {
  const root = mkdtempSync(join(tmpdir(), "run-pause-bridge-"))
  roots.push(root)
  const barrier = new AdmissionBarrier()
  const registry = new PauseRegistry(root, barrier)
  const calls: string[] = []
  const cutoffs: number[] = []
  const effects: RunPauseEffects = {
    snapshot: () => [{ key: "child", kind: "task", taskId: "child", runRef: { kind: "task", id: "child" }, state: "pending", at: "2026-01-01" }],
    quiesce: () => { calls.push("quiesce") },
    addFences: async () => { calls.push("fence") },
    pause: async () => ({ kind: "held", childSeq: 8 }),
    dispatchGuidance: async () => { calls.push("guidance") },
    resume: async (_participant, request) => {
      cutoffs.push(request.childSeqCutoff ?? -1)
      calls.push("resume")
      return { kind: "resumed", turnId: "turn-1" }
    },
    install: async () => { calls.push("install") },
    acknowledgeInstalled: async () => { calls.push("installed") },
    cancel: async () => undefined,
    ...overrides,
  }
  const controller = new RunPauseController(registry, effects)
  let state: EnginePauseState | undefined = held(7)
  const bridge = new EngineRunPauseBridge(controller, { getPauseState: () => state })
  return { root, bridge, registry, barrier, calls, cutoffs, setState: (next: EnginePauseState | undefined) => { state = next } }
}

test("Stop closes synchronously and Resume waits for propagation before freezing cutoffs", async () => {
  const ack = Promise.withResolvers<void>()
  const h = fixture({ pause: async () => { await ack.promise; return { kind: "held", childSeq: 8 } } })
  const pausing = h.bridge.changed("parent", { ...held(7), change: "paused" })
  expect(h.barrier.state("parent")).toEqual({ kind: "closed", pauseSeq: 7 })
  expect(h.registry.require("parent").phase).toBe("propagating")
  h.setState({ pauseSeq: 7, holds: [] })
  const resuming = h.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
  expect(h.calls).not.toContain("resume")
  ack.resolve()
  await pausing
  await resuming
  expect(h.cutoffs).toEqual([8])
  expect(h.calls.slice(-4)).toEqual(["guidance", "resume", "install", "installed"])
  expect(h.barrier.state("parent")).toEqual({ kind: "open" })
})

test("startup restores persisted custody before any child reconcile can run", async () => {
  const h = fixture()
  new PauseRegistry(h.root, new AdmissionBarrier()).begin("parent", 7, [])
  expect(h.barrier.state("parent").kind).toBe("open")
  await h.bridge.restore("parent")
  expect(h.barrier.state("parent")).toEqual({ kind: "closed", pauseSeq: 7 })
  expect(h.registry.require("parent").phase).toBe("propagating")
  await h.bridge.reconciled("parent")
  expect(h.registry.require("parent").phase).toBe("applied")
  expect(h.calls).not.toContain("resume")
})

test("missing native hold state cannot authorize a persisted run Resume", async () => {
  const h = fixture()
  new PauseRegistry(h.root, new AdmissionBarrier()).begin("parent", 7, [])
  h.setState(undefined)
  await h.bridge.restore("parent")
  expect(h.barrier.state("parent")).toEqual({ kind: "closed", pauseSeq: 7 })
  expect(h.calls).not.toContain("resume")
})

test("an old Resume event cannot reopen a newer Stop", async () => {
  const h = fixture()
  await h.bridge.changed("parent", { ...held(7), change: "paused" })
  h.setState(held(8))
  await h.bridge.changed("parent", { ...held(8), change: "paused" })
  await h.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
  expect(h.barrier.state("parent")).toEqual({ kind: "closed", pauseSeq: 8 })
  expect(h.calls).not.toContain("resume")
})

test("Option A keeps ordinary admission closed until installation acknowledges", async () => {
  const installing = Promise.withResolvers<void>()
  const installed = Promise.withResolvers<void>()
  const h = fixture({ install: async () => { installing.resolve(); await installed.promise } })
  await h.bridge.changed("parent", { ...held(7), change: "paused" })
  h.setState({ pauseSeq: 7, holds: [] })
  const resuming = h.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
  await installing.promise
  expect(h.barrier.state("parent").kind).toBe("resuming")
  expect(h.barrier.enter("parent", { key: "unrelated", runRef: { kind: "task", id: "unrelated" } }).kind).toBe("held")
  installed.resolve()
  await resuming
  expect(h.barrier.state("parent").kind).toBe("open")
})

test("a failed guidance dispatch can be retried under the same persisted Resume identity", async () => {
  let dispatches = 0
  const h = fixture({ dispatchGuidance: async () => {
    if (++dispatches === 1) throw new Error("delivery interrupted")
  } })
  await h.bridge.changed("parent", { ...held(7), change: "paused" })
  h.setState({ pauseSeq: 7, holds: [] })
  await expect(h.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })).rejects.toThrow()
  const resumeId = h.registry.require("parent").resume?.resumeId
  await h.bridge.changed("parent", { pauseSeq: 7, holds: [], change: "resumed" })
  expect(h.registry.require("parent").resume?.resumeId).toBe(resumeId)
  expect(h.cutoffs).toEqual([8])
  expect(h.barrier.state("parent").kind).toBe("open")
})

test("the real session_start bridge awaits registry restoration before lifecycle reconciliation", async () => {
  const h = fixture()
  new PauseRegistry(h.root, new AdmissionBarrier()).begin("parent", 7, [])
  const cwd = mkdtempSync(join(tmpdir(), "run-pause-startup-"))
  roots.push(cwd)
  const pi = new FakeExtensionAPI()
  const base = composeTaskEngine({ pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [], admissionBarrier: h.barrier })
  let reconciled = false
  const engine: TaskEngine = { ...base, lifecycle: { ...base.lifecycle,
    reconcileOnSessionStart: async () => {
      expect(h.registry.require("parent").phase).toBe("propagating")
      expect(h.barrier.state("parent").kind).toBe("closed")
      expect(await base.manager.start(baseSpec({ parent_session_id: "parent", root_session_id: "parent" }))).toMatchObject({ kind: "held" })
      reconciled = true
      return { outcomes: [] }
    },
  } }
  wireEventBridge(pi, {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    config: { getFlag: () => false }, getCapturedTools: () => [],
  }, engine, { scheduleSync: () => undefined, syncNow: () => undefined, observeRecord: () => undefined, dispose: () => undefined },
  createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
    runPause: h.bridge,
    reconcileTeamMailbox: async () => undefined,
    leadPollers: { tick: async () => undefined, shutdown: () => undefined },
    resumptionChannels: { emitSessionStart: async () => undefined, emitShutdown: async () => undefined },
  })
  const context = { sessionManager: { getSessionId: () => "parent" }, getPauseState: () => held(7) }
  await pi.dispatch("session_start", {}, context)
  expect(reconciled).toBe(true)
  expect(h.registry.require("parent").phase).toBe("applied")
  await pi.dispatch("session_shutdown", { reason: "quit" }, context)
})
