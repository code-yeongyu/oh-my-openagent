import { afterEach, expect, test } from "bun:test"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import { createTaskRecordStore } from "@oh-my-opencode/senpi-task"
import { seedRecord } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { cleanupProjects, FakeRunner, tempProject } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import type { EnginePauseState, RunRef } from "../../../../senpi-task/src/pause/ports"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import { wireEventBridge } from "./event-bridge"
import { createSessionTransitionBridge } from "./session-transition-bridge"

afterEach(cleanupProjects)

const PARENT = "parent-reopened"

function bounded<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`waited 5s for ${name}, never settled`)), 5_000)
  })
  return Promise.race([promise, expired]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

// senpi installs `session_hold` key `interrupted-run` before session_start when the previous run was interrupted; it is not a user Stop (#11856).
function reopenedAfterInterruptedRun(): { readonly state: () => EnginePauseState; readonly fenceRun: (ref: RunRef) => void; readonly fenced: RunRef[] } {
  let state: EnginePauseState = { pauseSeq: 2, holds: [{ kind: "session_hold", key: "interrupted-run" }] }
  const fenced: RunRef[] = []
  return {
    state: () => state,
    fenced,
    fenceRun: (ref) => {
      fenced.push(ref)
      state = { pauseSeq: state.pauseSeq + 1, holds: [...state.holds, { kind: "run_fence", key: `run_fence:${ref.kind}:${ref.id}`, data: { runRef: ref } }] }
    },
  }
}

test("#given a child parked by a mid-turn quit #when the same session reopens under only the engine's interrupted-run hold #then the session-start reconcile revives it and no run pause is created", async () => {
  const cwd = tempProject()
  const runner = new FakeRunner()
  const pi = new FakeExtensionAPI()
  pi.rpc = { emit: (name, data) => { pi.rpcEvents.push({ name, data }) } }
  const engine = composeTaskEngine({
    pi, cwd, omoConfig: loadOmoConfig({ cwd }).config, sharedParentTools: () => [],
    runnerFactories: { inProcess: () => runner, process: () => runner },
  })
  const store = createTaskRecordStore({ project_dir: cwd, task: { state_dir: engine.stateDir } })
  const parked = seedRecord(store, {
    task_id: "st_11856001", parent_session_id: PARENT, status: "running",
    residency_state: "persisted_only", execution_mode: "in-process",
    spawn_spec: { version: 1, cwd, prompt: "keep mapping the fingerprint signals" },
  })
  store.mutate(parked.task_id, (fresh) => ({ ...fresh, suspension_reason: "session_quit" }))
  const revived = Promise.withResolvers<void>()
  const unsubscribe = engine.onStoreMutation((change) => {
    const current = store.load(parked.task_id)
    if (change.taskId === parked.task_id && runner.handles.has(parked.task_id) && current?.status === "running" && current.residency_state === "resident") revived.resolve()
  })
  const engineHold = reopenedAfterInterruptedRun()
  const bridge = wireEventBridge(pi, {
    logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => false }, getCapturedTools: () => [],
  }, engine, { scheduleSync() {}, syncNow() {}, observeRecord() {}, dispose() {} },
  createSessionTransitionBridge({ runtime: engine.runtime, notifier: engine.notifier }), {
    runPause: engine.runPause?.bridge,
    reconcileTeamMailbox: async () => {},
    leadPollers: { tick: async () => {}, shutdown() {} },
    resumptionChannels: { emitSessionStart: async () => {}, emitShutdown: async () => {} },
  })
  const context = { sessionManager: { getSessionId: () => PARENT }, getPauseState: engineHold.state, fenceRun: engineHold.fenceRun }
  try {
    await pi.dispatch("session_start", {}, context)
    await bounded(bridge.sessionStartRecovered(), "the session-start recovery chain")
    await bounded(revived.promise, `child ${parked.task_id} to be revived`)

    const record = store.load(parked.task_id)
    expect(record).toMatchObject({ status: "running", residency_state: "resident" })
    expect(record?.suspension_reason).toBeUndefined()
    expect(record?.run_pause).toBeUndefined()
    expect(runner.startedSpecs.map((spec) => spec.taskId)).toEqual([parked.task_id])
    expect(engine.runPause?.registry.load(PARENT)).toBeUndefined()
    expect(engine.admissionBarrier.state(PARENT)).toEqual({ kind: "open" })
    expect(engineHold.fenced).toEqual([])
  } finally {
    unsubscribe()
    await pi.dispatch("session_shutdown", { reason: "quit" }, context)
    for (const { record } of engine.manager.list({ scope: "all" })) await engine.manager.cancelTask(record.task_id)
    engine.manager.workpools?.dispose()
    engine.lifecycle.dispose?.()
  }
}, 15_000)
