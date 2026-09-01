import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createCompletionNotifier } from "../completion"
import type { CompletionNotifier, CompletionRetrySchedule } from "../completion"
import type { ResidencyRegistry, TaskLifecycle } from "../lifecycle"
import type { TaskManager } from "../manager"
import { createTaskRecordStore } from "../store"
import type { PersistedTaskEvent, TaskRecordStore } from "../store"
import { ChaosProcessTable, ChaosRunner } from "./chaos-engine"
import type { LifecycleChaosObservations } from "./chaos-engine"
import { buildChaosEngines } from "./chaos-engine-factory"
import type { ChaosEngine } from "./chaos-engine-factory"
import { createChaosNotifier, createNotificationEpochTracker, instrumentCompletionNotifier } from "./chaos-invariants"
import type { ChaosNotifier } from "./chaos-invariants"
import { createObservingStore } from "./observing-store"
import type { StoreObservations } from "./observing-store"

export const CHAOS_MODEL = "anthropic/claude"
export const CHAOS_SESSION = "parent-chaos"

const CLOCK_BASE = 1_800_000_000_000
const CLOCK_STEP = 1_000

type ScheduledRetry = { readonly run: () => void; readonly delayMs: number }
export type ChaosRetryScheduler = { readonly pendingCount: number; readonly schedule: CompletionRetrySchedule; run(index: number): boolean }

function makeRetryScheduler(): ChaosRetryScheduler {
  const pending = new Map<number, ScheduledRetry>()
  let nextId = 0
  return {
    get pendingCount() { return pending.size },
    schedule: (run, delayMs) => {
      const id = nextId++
      pending.set(id, { run, delayMs })
      return () => { pending.delete(id) }
    },
    run(index) {
      const selected = [...pending.entries()][index]
      if (selected === undefined) return false
      pending.delete(selected[0])
      selected[1].run()
      return true
    },
  }
}

export type ChaosWaiters = {
  readonly registrations: number
  readonly settlements: number
  register(taskId: string, abortAfterSteps: number): void
  advance(): void
  abortAll(): void
}

function makeWaiters(manager: TaskManager): ChaosWaiters {
  const scheduled = new Map<AbortController, number>()
  let currentStep = 0
  let registrations = 0
  let settlements = 0
  return {
    get registrations() { return registrations },
    get settlements() { return settlements },
    register(taskId, abortAfterSteps) {
      const controller = new AbortController()
      registrations += 1
      scheduled.set(controller, currentStep + abortAfterSteps)
      void manager.waitFor(taskId, { signal: controller.signal }).then(
        () => { settlements += 1 },
        () => { settlements += 1 },
      )
    },
    advance() {
      currentStep += 1
      for (const [controller, abortAtStep] of scheduled) {
        if (abortAtStep > currentStep) continue
        scheduled.delete(controller)
        controller.abort(new DOMException("chaos parent wait aborted", "AbortError"))
      }
    },
    abortAll() {
      for (const controller of scheduled.keys()) controller.abort(new DOMException("chaos parent wait drained", "AbortError"))
      scheduled.clear()
    },
  }
}

function makeClock(): () => number {
  let ticks = 0
  return () => CLOCK_BASE + CLOCK_STEP * ticks++
}

export type ChaosHarness = {
  readonly model: string
  readonly sessionId: string
  readonly manager: TaskManager
  readonly lifecycle: TaskLifecycle
  readonly notifier: CompletionNotifier
  readonly parentNotifier: ChaosNotifier
  readonly retryScheduler: ChaosRetryScheduler
  readonly waiters: ChaosWaiters
  readonly runner: ChaosRunner
  readonly registry: ResidencyRegistry
  readonly engines: readonly ChaosEngine[]
  readonly probeEngine: ChaosEngine
  readonly processes: ChaosProcessTable
  readonly lifecycleObservations: LifecycleChaosObservations
  readonly observations: StoreObservations
  readonly store: TaskRecordStore
  readonly pendingCancelledTaskIds: ReadonlySet<string>
  readonly residencyMax: number
  readonly limit: number
  readonly cleanup: () => void
  writeSession(taskId: string): string
  observeLiveHandles(): void
}

export type ChaosHarnessOptions = { readonly concurrency: number; readonly residencyMax: number; readonly maxDepth: number }

function observePendingCancellations(store: TaskRecordStore, taskIds: Set<string>): TaskRecordStore {
  return { ...store, appendEvent: (taskId, event: PersistedTaskEvent) => {
    if (event.type === "cancelled" && typeof event.payload === "object" && event.payload !== null &&
      "previous_status" in event.payload && event.payload.previous_status === "pending") taskIds.add(taskId)
    return store.appendEvent(taskId, event)
  } }
}

export function buildHarness(options: ChaosHarnessOptions): ChaosHarness {
  const project = mkdtempSync(join(tmpdir(), "senpi-chaos-"))
  const observed = createObservingStore(createTaskRecordStore({ project_dir: project }))
  const pendingCancelledTaskIds = new Set<string>()
  const store = observePendingCancellations(observed.store, pendingCancelledTaskIds)
  const clock = makeClock()
  const config = OmoTaskSettingsSchema.parse({
    default_concurrency: options.concurrency,
    residency_max_children: options.residencyMax,
    max_depth: options.maxDepth,
    resume_children: true,
  })
  const processes = new ChaosProcessTable()
  const lifecycleObservations: LifecycleChaosObservations = {
    actionCounts: { suspend_session: 0, resume_session: 0, crash_mid_suspend: 0, sibling_reconcile_race: 0, mass_revive_at_cap: 0 },
    liveHandleBreaches: [], pidBreaches: [], reclamationBreaches: [], terminalRelaunches: [], actionTrace: [],
  }
  const engines = buildChaosEngines({
    store, config, clock, project, model: CHAOS_MODEL, processes, observations: lifecycleObservations,
  })

  const primary = engines[0]
  const probeEngine = engines[2]
  if (primary === undefined || probeEngine === undefined) throw new Error("chaos engine unavailable")
  const retryScheduler = makeRetryScheduler()
  const waiters = makeWaiters(primary.manager)
  const notificationEpochs = createNotificationEpochTracker()
  const parentNotifier = createChaosNotifier(store, observed.observations, notificationEpochs)
  const notifier = instrumentCompletionNotifier(createCompletionNotifier({
    notifier: parentNotifier, store, schedule: retryScheduler.schedule,
    getCurrentSessionId: () => CHAOS_SESSION, getParentState: () => ({ kind: "idle" }),
  }), store, notificationEpochs)

  return makeHarnessResult({
    project, options, store, observed: observed.observations, pendingCancelledTaskIds, engines,
    primary, probeEngine, processes, lifecycleObservations, retryScheduler, waiters, parentNotifier, notifier,
  })
}

type HarnessResultInput = {
  readonly project: string
  readonly options: ChaosHarnessOptions
  readonly store: TaskRecordStore
  readonly observed: StoreObservations
  readonly pendingCancelledTaskIds: Set<string>
  readonly engines: readonly ChaosEngine[]
  readonly primary: ChaosEngine
  readonly probeEngine: ChaosEngine
  readonly processes: ChaosProcessTable
  readonly lifecycleObservations: LifecycleChaosObservations
  readonly retryScheduler: ChaosRetryScheduler
  readonly waiters: ChaosWaiters
  readonly parentNotifier: ChaosNotifier
  readonly notifier: CompletionNotifier
}

function makeHarnessResult(input: HarnessResultInput): ChaosHarness {
  const { primary, store } = input
  return {
    model: CHAOS_MODEL, sessionId: CHAOS_SESSION, manager: primary.manager, lifecycle: primary.lifecycle,
    notifier: input.notifier, parentNotifier: input.parentNotifier, retryScheduler: input.retryScheduler,
    waiters: input.waiters, runner: primary.inProcessRunner, registry: primary.registry,
    engines: input.engines, probeEngine: input.probeEngine, processes: input.processes,
    lifecycleObservations: input.lifecycleObservations, observations: input.observed, store,
    pendingCancelledTaskIds: input.pendingCancelledTaskIds, residencyMax: input.options.residencyMax,
    limit: input.options.concurrency,
    writeSession(taskId) {
      const directory = join(store.stateDir, "children", taskId, "sessions")
      mkdirSync(directory, { recursive: true })
      const path = join(directory, `${taskId}.jsonl`)
      writeFileSync(path, `${JSON.stringify({ type: "message", message: { role: "assistant", content: "done" } })}\n`)
      return path
    },
    observeLiveHandles() {
      const owners = new Map<string, string[]>()
      for (const engine of input.engines) {
        for (const taskId of engine.manager.residentTaskIds()) {
          const list = owners.get(taskId) ?? []
          list.push(engine.id)
          owners.set(taskId, list)
        }
      }
      for (const [taskId, ids] of owners) {
        if (ids.length > 1) {
          const trace = input.lifecycleObservations.actionTrace.slice(-12).join(" -> ")
          const record = store.load(taskId)
          input.lifecycleObservations.liveHandleBreaches.push(
            `${taskId} live in ${ids.join(",")} host=${record?.host_pid ?? "none"} status=${record?.status ?? "missing"}/${record?.residency_state ?? "missing"} after ${trace}`,
          )
        }
      }
    },
    cleanup: () => rmSync(input.project, { recursive: true, force: true }),
  }
}
