// allow: SIZE_OK - this restart fixture keeps manager, store and notifier replacement in one shared
// closure so tests observe the same terminal ledger before and after a simulated process restart.
import { createCompletionNotifier } from "../../completion/notifier"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { resolveChildSessionDir } from "../../runners/rpc/spawn"
import type { ParentNotifierMessage, ParentState } from "../../completion/types"
import { baseSpec, FakeRunner, makeHandle, makeManager } from "../../manager/__fixtures__/manager-fakes"
import type { TaskRecord } from "../../state"
import type { TaskRecordStore } from "../../store"
import { createTaskRecordStore } from "../../store"
import { createTaskLifecycle } from "../create"
import type { LifecycleDeps, ResidentHandle, RespawnFailureCode } from "../port"
import { hostLifecycleDeps, hostSession } from "./host-session-fakes"
import { settings, tempStore } from "./lifecycle-fakes"
import { bounded, recoveryClock, signal } from "./live-parent-clock"
import { observeLifecycleStore } from "./observed-lifecycle-store"

export { bounded, signal } from "./live-parent-clock"

export function liveParentFixture(mode: "in-process" | "child-process" | "host-session" = "in-process") {
  let backing = tempStore()
  const messages: ParentNotifierMessage[] = []
  const terminals: TaskRecord[] = []
  const recordedEvents: Array<{ readonly type: string; readonly payload: unknown }> = []
  const parent: { value: ParentState } = { value: { kind: "idle" } }
  const newNotifier = () =>
    createCompletionNotifier({
      store: backing,
      stateDir: backing.stateDir,
      notifier: { enqueue: (message) => messages.push(message) },
      getCurrentSessionId: () => "parent-1",
    })
  let notifier = newNotifier()
  const listeners = new Set<() => void>()
  const events = new Map<string, Array<() => void>>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  let beforeMutate: (() => void) | undefined
  const observed = () =>
    observeLifecycleStore(backing, {
      changed,
      terminal: (record) => {
        terminals.push(record)
        notifier.notifyTerminal({
          record,
          parentState: parent.value,
          runInBackground: true,
        })
      },
      event: (type, payload) => {
        recordedEvents.push({ type, payload })
        for (const resolve of events.get(type)?.splice(0) ?? []) resolve()
      },
      beforeMutate: () => {
        const hook = beforeMutate
        beforeMutate = undefined
        hook?.()
      },
    })
  let store: TaskRecordStore = observed()
  const { clock, timers, scheduler, advance } = recoveryClock()
  const runner = new FakeRunner()
  const alivePids = new Set<number>()
  const signals: number[] = []
  if (mode === "child-process") runner.childPid = 42424
  const config = settings({
    default_concurrency: 1,
    global_concurrency: 0,
    resident_idle_timeout_ms: 600_000,
  })
  const newManager = () =>
    makeManager({
      store,
      project: backing.stateDir,
      inProcess: runner,
      process: runner,
      config,
    }).manager
  let manager = newManager()
  const host = hostLifecycleDeps({
    store,
    hostPid: process.pid,
    now: () => clock.now,
  })
  const state = {
    live: true,
    revivable: false,
    closes: 0,
    closeRefused: true,
    respawns: 0,
    stopConfirmed: true,
    failureCode: "model_unavailable" as RespawnFailureCode,
    permanentFailure: false,
  }
  const resumedHandles = new Map<string, ReturnType<typeof makeHandle>>()
  let respawnGate: ReturnType<typeof signal<void>> | undefined
  let respawnStarted = signal<void>()
  let closeGate: ReturnType<typeof signal<void>> | undefined
  let closeStarted = signal<void>()
  const registry = {
    get: (id: string): ResidentHandle | undefined => {
      const handle = manager.getResidentHandle(id)
      return handle === undefined
        ? undefined
        : {
            task_id: id,
            kind: mode === "child-process" ? "rpc" : mode,
            pid: handle.pid,
            abort: handle.abort,
            dispose: handle.dispose,
            terminate: handle.terminate ?? (async () => undefined),
          }
    },
    entries: (): readonly ResidentHandle[] => manager.residentTaskIds().flatMap((id) => {
      const handle = registry.get(id)
      return handle === undefined ? [] : [handle]
    }),
    forget: (id: string) => manager.forget(id),
    hasPendingSends: () => false,
    ownsRecord: (record: { readonly parent_session_id: string }) =>
      state.live && record.parent_session_id === "parent-1",
  }
  const subscription = {
    onStoreMutation: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const deps: LifecycleDeps = {
    ...host.deps,
    ...subscription,
    store,
    registry,
    config,
    idleReclaimerScheduler: scheduler,
    hostCloseScheduler: scheduler,
    signaller: {
      isAlive: (pid) => alivePids.has(pid),
      signal: (pid) => {
        signals.push(pid)
        if (state.stopConfirmed) alivePids.delete(pid)
      },
    },
    respawn: async (record) => {
      state.respawns += 1
      respawnStarted.resolve()
      if (respawnGate !== undefined) await respawnGate.promise
      const resumed = makeHandle(record.task_id)
      resumedHandles.set(record.task_id, resumed)
      return state.revivable
        ? { ok: true, handle: resumed.handle }
        : {
            ok: false,
            disposition: state.permanentFailure ? "unrecoverable" : "retryable",
            code: state.failureCode,
            reason: "fixture model unavailable",
          }
    },
    reattach: (record, handle) => manager.reattach(record, handle),
    hostSessionClose: async (request) => {
      state.closes += 1
      closeStarted.resolve()
      if (closeGate !== undefined) await closeGate.promise
      if (state.closeRefused || !host.daemon.alive) throw new Error("fixture daemon unreachable")
      await host.daemon.close(request)
    },
    hostRetry: {
      ...host.deps.hostRetry,
      maxDrainAttempts: 1,
      defaultRetryAfterMs: 2_000,
      daemonLossBackoffMs: [],
      deferredRetryBackoffMs: [],
      wait: async () => undefined,
    },
  }
  let lifecycle = createTaskLifecycle(deps)
  return {
    get store() {
      return store
    },
    get backing() {
      return backing
    },
    get manager() {
      return manager
    },
    get notifier() {
      return notifier
    },
    runner,
    resumedHandles,
    state,
    messages,
    recordedEvents,
    terminals,
    parent,
    host,
    registry,
    timers,
    signals,
    alivePids,
    deps,
    get lifecycle() {
      return lifecycle
    },
    beforeNextMutation: (hook: () => void) => {
      beforeMutate = hook
    },
    wait: (event: string) => {
      const waiting = signal<void>()
      const entries = events.get(event) ?? []
      entries.push(() => waiting.resolve())
      events.set(event, entries)
      return bounded(waiting.promise)
    },
    holdRevival: () => {
      respawnGate = signal<void>()
      respawnStarted = signal<void>()
      return { ...respawnGate, started: bounded(respawnStarted.promise) }
    },
    holdClose: () => {
      closeGate = signal<void>()
      closeStarted = signal<void>()
      return { ...closeGate, started: closeStarted.promise }
    },
    nextClose: () => {
      closeStarted = signal<void>()
      return bounded(closeStarted.promise)
    },
    until: (predicate: () => boolean) => {
      const reached = signal<void>()
      const listener = () => {
        if (!predicate()) return
        listeners.delete(listener)
        reached.resolve()
      }
      listeners.add(listener)
      listener()
      return bounded(reached.promise)
    },
    advance,
    start: async () => {
      const result = await manager.start(
        baseSpec({
          run_in_background: true,
          execution_mode: mode === "in-process" ? "in-process" : "process",
        }),
      )
      if (result.kind !== "started") throw new Error(`fixture start failed: ${result.kind}`)
      if (result.status === "running" && mode !== "host-session") {
        const sessions = resolveChildSessionDir(join(backing.stateDir, "children", result.task_id), result.task_id)
        mkdirSync(sessions, { recursive: true })
        writeFileSync(join(sessions, "child.jsonl"), '{"type":"session","id":"fixture-session"}\n')
      }
      if (mode === "child-process") alivePids.add(42424)
      if (mode === "host-session") {
        const identity = hostSession(result.task_id)
        store.mutate(result.task_id, (record) => ({
          ...record,
          runner_kind: "host-session",
          host_session: identity,
        }))
        host.daemon.hold(identity.session_path)
      }
      return result.task_id
    },
    park: (id: string) => runner.handles.get(id)?.park("idle_evicted"),
    restart: () => {
      lifecycle.dispose?.()
      backing = createTaskRecordStore({
        project_dir: backing.stateDir,
        task: { state_dir: backing.stateDir },
      })
      notifier = newNotifier()
      store = observed()
      manager = newManager()
      lifecycle = createTaskLifecycle({ ...deps, store })
      return lifecycle
    },
    dispose: () => lifecycle.dispose?.(),
  }
}
