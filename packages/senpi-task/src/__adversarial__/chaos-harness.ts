import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import { createCompletionNotifier } from "../completion"
import type { CompletionNotifier, ParentNotifier, ParentNotifierMessage } from "../completion"
import { createTaskLifecycle } from "../lifecycle"
import type { ProcessSignaller, TaskLifecycle } from "../lifecycle"
import { FakeRegistry, fakeHandle } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { makeHandle } from "../manager/__fixtures__/manager-fakes"
import type { FakeHandle } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec, TaskManager } from "../manager"
import type { DestructionPort } from "../steering"
import { createTaskRecordStore } from "../store"
import { createObservingStore } from "./observing-store"
import type { StoreObservations } from "./observing-store"
import type { TaskRecordStore } from "../store"

export const CHAOS_MODEL = "anthropic/claude"
export const CHAOS_SESSION = "parent-chaos"

const CLOCK_BASE = 1_800_000_000_000
const CLOCK_STEP = 1_000

// Strictly-increasing injected clock: keeps updated_at deterministic (so LRU eviction is replayable)
// without any Date.now dependency inside the bench.
function makeClock(): () => number {
  let ticks = 0
  return () => CLOCK_BASE + CLOCK_STEP * ticks++
}

function alwaysAlive(): ProcessSignaller {
  return { isAlive: () => true, signal: () => {} }
}

function singleModelPlanner(): ChildPlanner {
  return (spec) => ({ kind: "resolved", plan: { model: spec.model ?? CHAOS_MODEL } })
}

export type ChaosNotifier = ParentNotifier & {
  readonly calls: ParentNotifierMessage[]
  failNext(count: number): void
}

// The parent notifier seam. On every successful enqueue it records, per completion detail, the
// task's CURRENT run_epoch: two enqueues for one (task, epoch) is a broken exactly-once guarantee.
function makeNotifier(store: TaskRecordStore, observations: StoreObservations): ChaosNotifier {
  const calls: ParentNotifierMessage[] = []
  let remainingFailures = 0
  return {
    calls,
    failNext(count: number) {
      remainingFailures = count
    },
    enqueue(message) {
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error("chaos parent gone")
      }
      calls.push(message)
      for (const detail of message.details) {
        const epoch = store.load(detail.task_id)?.notification.run_epoch ?? 0
        const key = `${detail.task_id}:${epoch}`
        observations.enqueueByEpoch.set(key, (observations.enqueueByEpoch.get(key) ?? 0) + 1)
      }
    },
  }
}

// A runner whose handles are settled on demand by the schedule. Every launch also registers a
// resident handle so lifecycle eviction / shutdown / reconciliation have something to tear down,
// mirroring the todo-17 composition seam.
class ChaosRunner implements ManagedRunner {
  readonly handles = new Map<string, FakeHandle>()
  readonly #registry: FakeRegistry

  constructor(registry: FakeRegistry) {
    this.#registry = registry
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandleShape> {
    const fake = makeHandle(spec.taskId)
    this.handles.set(spec.taskId, fake)
    this.#registry.add(fakeHandle(spec.taskId, "in-process", []))
    return Promise.resolve(fake.handle)
  }
}

type ManagedChildHandleShape = ReturnType<typeof makeHandle>["handle"]

export type ChaosHarness = {
  readonly manager: TaskManager
  readonly lifecycle: TaskLifecycle
  readonly notifier: CompletionNotifier
  readonly parentNotifier: ChaosNotifier
  readonly runner: ChaosRunner
  readonly registry: FakeRegistry
  readonly observations: StoreObservations
  readonly store: ReturnType<typeof createObservingStore>["store"]
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
  const { store, observations } = createObservingStore(createTaskRecordStore({ project_dir: project }))
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
  const parentNotifier = makeNotifier(store, observations)
  const notifier = createCompletionNotifier({ notifier: parentNotifier, store })

  return {
    manager,
    lifecycle,
    notifier,
    parentNotifier,
    runner,
    registry,
    observations,
    store,
    limit: options.concurrency,
    cleanup: () => rmSync(project, { recursive: true, force: true }),
  }
}
