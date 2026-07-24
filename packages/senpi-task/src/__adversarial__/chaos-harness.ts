import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createCompletionNotifier } from "../completion"
import type { CompletionNotifier, CompletionRetrySchedule } from "../completion"
import { createTaskLifecycle } from "../lifecycle"
import type { ProcessSignaller, TaskLifecycle } from "../lifecycle"
import { FakeRegistry, fakeHandle } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { makeHandle } from "../manager/__fixtures__/manager-fakes"
import type { FakeHandle } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec, TaskManager } from "../manager"
import type { DestructionPort } from "../steering"
import { createTaskRecordStore } from "../store"
import type { PersistedTaskEvent, TaskRecordStore } from "../store"
import { createChaosNotifier, createNotificationEpochTracker, instrumentCompletionNotifier } from "./chaos-invariants"
import type { ChaosNotifier } from "./chaos-invariants"
import { createObservingStore } from "./observing-store"
import type { StoreObservations } from "./observing-store"

export const CHAOS_MODEL = "anthropic/claude"
export const CHAOS_SESSION = "parent-chaos"

const CLOCK_BASE = 1_800_000_000_000
const CLOCK_STEP = 1_000

type ScheduledRetry = {
  readonly run: () => void
  readonly delayMs: number
}

export type ChaosRetryScheduler = {
  readonly pendingCount: number
  readonly schedule: CompletionRetrySchedule
  run(index: number): boolean
}

function makeRetryScheduler(): ChaosRetryScheduler {
  const pending = new Map<number, ScheduledRetry>()
  let nextId = 0
  const schedule: CompletionRetrySchedule = (run, delayMs) => {
    const id = nextId
    nextId += 1
    pending.set(id, { run, delayMs })
    return () => {
      pending.delete(id)
    }
  }
  return {
    get pendingCount() {
      return pending.size
    },
    schedule,
    run(index) {
      const selected = [...pending.entries()][index]
      if (selected === undefined) return false
      const [id, scheduled] = selected
      pending.delete(id)
      scheduled.run()
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
    get registrations() {
      return registrations
    },
    get settlements() {
      return settlements
    },
    register(taskId, abortAfterSteps) {
      const controller = new AbortController()
      registrations += 1
      scheduled.set(controller, currentStep + abortAfterSteps)
      void manager.waitFor(taskId, { signal: controller.signal }).then(
        () => {
          settlements += 1
        },
        () => {
          settlements += 1
        },
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
      for (const controller of scheduled.keys()) {
        controller.abort(new DOMException("chaos parent wait drained", "AbortError"))
      }
      scheduled.clear()
    },
  }
}

function isPendingCancelEvent(event: PersistedTaskEvent): boolean {
  if (event.type !== "cancelled") return false
  if (typeof event.payload !== "object" || event.payload === null) return false
  if (!("previous_status" in event.payload)) return false
  return event.payload.previous_status === "pending"
}

function observePendingCancellations(store: TaskRecordStore, taskIds: Set<string>): TaskRecordStore {
  return {
    ...store,
    appendEvent: (taskId, event) => {
      if (isPendingCancelEvent(event)) taskIds.add(taskId)
      return store.appendEvent(taskId, event)
    },
  }
}

// Strictly-increasing injected clock: keeps updated_at deterministic (so LRU eviction is replayable)
// without any Date.now dependency inside the bench.
function makeClock(): () => number {
  let ticks = 0
  return () => CLOCK_BASE + CLOCK_STEP * ticks++
}

function alwaysAlive(): ProcessSignaller {
  return { isAlive: () => true }
}

function singleModelPlanner(): ChildPlanner {
  return (spec) => ({ kind: "resolved", plan: { model: spec.model ?? CHAOS_MODEL } })
}

// A runner whose handles are settled on demand by the schedule. Every launch also registers a
// resident handle so lifecycle eviction / shutdown / reconciliation have something to tear down,
// mirroring the todo-17 composition seam.
class ChaosRunner implements ManagedRunner {
  readonly handles = new Map<string, FakeHandle>()
  readonly startedTaskIds: string[] = []
  readonly #registry: FakeRegistry

  constructor(registry: FakeRegistry) {
    this.#registry = registry
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandleShape> {
    this.startedTaskIds.push(spec.taskId)
    const fake = makeHandle(spec.taskId)
    this.handles.set(spec.taskId, fake)
    this.#registry.add(fakeHandle(spec.taskId, "in-process", []))
    return Promise.resolve(fake.handle)
  }
}

type ManagedChildHandleShape = ReturnType<typeof makeHandle>["handle"]

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
  readonly registry: FakeRegistry
  readonly observations: StoreObservations
  readonly store: ReturnType<typeof createObservingStore>["store"]
  readonly pendingCancelledTaskIds: ReadonlySet<string>
  readonly limit: number
  readonly cleanup: () => void
}

export type ChaosHarnessOptions = {
  readonly concurrency: number
  readonly residencyMax: number
  readonly maxDepth: number
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
  })

  const registry = new FakeRegistry()
  const lifecycle = createTaskLifecycle({ store, registry, config, now: clock, signaller: alwaysAlive() })
  const destruction: DestructionPort = { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") }
  const runner = new ChaosRunner(registry)
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: singleModelPlanner(),
    config,
    cwd: project,
    now: clock,
    destruction,
  })
  const retryScheduler = makeRetryScheduler()
  const waiters = makeWaiters(manager)
  const notificationEpochs = createNotificationEpochTracker()
  const parentNotifier = createChaosNotifier(store, observed.observations, notificationEpochs)
  const baseNotifier = createCompletionNotifier({
    notifier: parentNotifier,
    store,
    schedule: retryScheduler.schedule,
    getCurrentSessionId: () => CHAOS_SESSION,
    getParentState: () => ({ kind: "idle" }),
  })
  const notifier = instrumentCompletionNotifier(baseNotifier, store, notificationEpochs)

  return {
    model: CHAOS_MODEL,
    sessionId: CHAOS_SESSION,
    manager,
    lifecycle,
    notifier,
    parentNotifier,
    retryScheduler,
    waiters,
    runner,
    registry,
    observations: observed.observations,
    store,
    pendingCancelledTaskIds,
    limit: options.concurrency,
    cleanup: () => rmSync(project, { recursive: true, force: true }),
  }
}
