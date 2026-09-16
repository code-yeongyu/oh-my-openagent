import { afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../../lifecycle"
import type { ResidencyRegistry } from "../../lifecycle/port"
import { createTaskManager } from "../../manager/manager"
import { TaskConcurrency } from "../../manager/concurrency"
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { KernelToolBindingRegistry } from "../../kernel-tools/bindings"
import type { AdmitResident, ChildPlanner, ManagedRunner, ManagedStartSpec } from "../../manager/types"
import type { RunnerOutcome } from "../../runners/in-process/child-handle"
import { createTaskRecordStore } from "../../store"
import type { WorkpoolCreate, WorkpoolEvent } from "../types"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
export const poolInput: WorkpoolCreate = { name: "batch", agent: { category: "quick", prompt: "Process input" }, mode: "fresh" }
export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred was not initialized") }
  let reject: (error: unknown) => void = () => { throw new Error("Deferred was not initialized") }
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export function bounded<T>(promise: Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(5000)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}
export function fixtureHandle(taskId: string) {
  let cycle = deferred<RunnerOutcome>()
  const followUps: string[] = []
  const settle = (value: RunnerOutcome): void => { const prior = cycle; cycle = deferred<RunnerOutcome>(); prior.resolve(value) }
  const handle: ManagedChildHandle = {
    task_id: taskId, sessionId: `worker-${taskId}`, pid: undefined,
    waitForOutcome: () => cycle.promise, followUp: async message => { followUps.push(message) }, steer: async () => undefined,
    abort: async () => settle({ status: "cancelled" }), dispose: async () => undefined,
    subscribe: () => () => undefined, lastAssistantText: () => undefined,
  }
  return { handle, settle, followUps }
}
export function fixture(options: {
  readonly concurrency?: TaskConcurrency
  readonly config?: Record<string, unknown>
  readonly admit?: AdmitResident
  readonly planner?: ChildPlanner
  readonly runner?: ManagedRunner
  // The engine's runtime parent kernel-tool map, so a test can watch a pool binding appear and go.
  readonly kernelToolBindings?: KernelToolBindingRegistry
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "workpool-admission-"))
  const store = createTaskRecordStore({ project_dir: root })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4, ...options.config })
  const concurrency = options.concurrency ?? new TaskConcurrency(config)
  const starts: ManagedStartSpec[] = []
  const handles = new Map<string, ReturnType<typeof fixtureHandle>>()
  const runner: ManagedRunner = options.runner ?? { start: async spec => {
    starts.push(spec)
    const child = fixtureHandle(spec.taskId)
    handles.set(spec.taskId, child)
    return child.handle
  } }
  const registry: ResidencyRegistry = {
    get: taskId => {
      const child = manager.getResidentHandle(taskId)
      return child === undefined ? undefined : { task_id: taskId, kind: "in-process", pid: undefined,
        abort: () => child.abort(), dispose: () => child.dispose(), terminate: async () => undefined }
    },
    entries: () => manager.residentTaskIds().flatMap(id => { const child = registry.get(id); return child === undefined ? [] : [child] }),
    forget: taskId => manager.forget(taskId), hasPendingSends: taskId => manager.hasPendingSends?.(taskId) ?? false,
    tryClaimEviction: taskId => manager.tryClaimEviction?.(taskId) ?? false,
    releaseEviction: taskId => manager.releaseEviction?.(taskId),
  }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    ...(options.kernelToolBindings === undefined ? {} : { kernelToolBindings: options.kernelToolBindings }),
    planner: options.planner ?? (spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model", ...(spec.subagent_type === undefined ? {} : { agentType: spec.subagent_type }) } })),
    destruction: lifecycle,
    admit: options.admit ?? (async parent => {
      const result = await lifecycle.admitResident(parent)
      return result.kind === "rejected" ? { kind: "rejected", message: result.error.message } : result
    }),
  })
  const events: WorkpoolEvent[] = []
  manager.workpools.subscribe(event => events.push(event))
  cleanups.push(async () => {
    manager.workpools.dispose()
    lifecycle.dispose?.()
    for (const taskId of manager.residentTaskIds()) await lifecycle.destroyResidentTask(taskId, "cancel")
    rmSync(root, { recursive: true, force: true })
  })
  const caller = { sessionId: "parent", rootSessionId: "root", depth: 0, cwd: root }
  return { root, store, manager, lifecycle, starts, handles, concurrency, caller, events }
}
export function evidence(name: string, data: unknown): void {
  const root = process.env.WORKPOOL_EVIDENCE_DIR
  if (root === undefined) return
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, `${name}.json`), JSON.stringify({ at: new Date().toISOString(), source: process.env.WORKPOOL_SOURCE_SHA, data }, null, 2))
}
