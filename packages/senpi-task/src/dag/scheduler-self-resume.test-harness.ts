// Shared fake for the self-resumed node child cases (#12134): a task manager whose children finish,
// resume on their own (task_self_resumed), get denied residency on demand, and record every
// start, cancel and send, plus a scheduler fixture over the in-memory DAG store.
import { join } from "node:path"
import * as fs from "node:fs"
import { tmpdir } from "node:os"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import type { CancelOptions, CancelOutcome, SendInput, SendOutcome } from "../steering"
import { createInMemoryDagStore } from "./__fixtures__/in-memory-store"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaims } from "../manager/owned-claims"
import type { DagTaskOwner, DagTaskOwnerScope, OwnedStartResult } from "./owner"
import { createDagRunReservations } from "./run-reservations"
import { createDagScheduler, type DagSchedulerOptions } from "./scheduler"
import type { DagNodeId, DagNodeState, DagRunEvent } from "./types"
import { parentSessionId, runId } from "./scheduler-self-resume-record.test-harness"

export { node, recordFor, runId } from "./scheduler-self-resume-record.test-harness"

export function deferred<T = void>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function within<T>(promise: Promise<T>, ms = 2_000, waitingFor = "the signal"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`waited ${ms}ms for ${waitingFor}; it never came`)), ms)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

type Signal = { readonly promise: Promise<void>; readonly resolve: () => void }
type Task = { record: TaskRecord; completion: ReturnType<typeof deferred<TaskRecord>> }

export type FakeHooks = {
  startGate?: (nodeId: string) => Promise<void>
  denyResidency?: (nodeId: string) => boolean
  onCancel?: (nodeId: string) => void
  onStart?: (nodeId: string) => void
}

const notUsed = (): Promise<never> => Promise.reject(new Error("not used by these cases"))

export class SelfResumingTaskManager implements TaskManager {
  readonly starts: string[] = []
  readonly denials: string[] = []
  readonly cancellations: string[] = []
  readonly sends: SendInput[] = []
  readonly hooks: FakeHooks
  readonly #tasks = new Map<string, Task>()
  readonly #started = new Map<string, Signal>()
  readonly #selfResumed = new Map<string, Set<() => void>>()

  constructor(hooks: FakeHooks = {}) {
    this.hooks = hooks
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId)
    await this.hooks.startGate?.(nodeId)
    if (this.hooks.denyResidency?.(nodeId) === true) {
      this.denials.push(nodeId)
      const residents = [{ task_id: "task-elsewhere", name: "elsewhere", status: "running" as const }]
      return { kind: "residency_denied", reason: "cap", cause: "residents", max_children: 1, residents }
    }
    const record = this.#put(nodeId, "running", owner).record
    this.starts.push(nodeId)
    this.hooks.onStart?.(nodeId)
    this.#signal(this.#started, nodeId).resolve()
    return { kind: "started", reused: false, task_id: record.task_id, status: "running", name: nodeId }
  }

  // A task record this run owns without having admitted it here (recovery hands such tasks over).
  seed(nodeId: string, status: TaskStatus): TaskRecord {
    const owner: DagTaskOwner = { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: `fp-${nodeId}` }
    const task = this.#put(nodeId, status, owner)
    if (status !== "running") task.completion.resolve(task.record)
    return task.record
  }

  whenStarted(nodeId: string): Promise<void> {
    return this.#signal(this.#started, nodeId).promise
  }

  taskOf = (nodeId: string): TaskRecord => this.#byNode(nodeId).record

  complete(nodeId: string, status: TaskStatus = "completed", runStats?: TaskRecord["run_stats"]): void {
    const task = this.#byNode(nodeId)
    task.record = {
      ...task.record,
      status,
      ...(runStats === undefined ? {} : { run_stats: runStats }),
      ...(status === "completed" ? { final_response: `done ${nodeId}` } : { error_message: `${status} ${nodeId}` }),
    }
    task.completion.resolve(task.record)
  }

  // Mirrors the manager's self-resumed reopen (omo#9069): the record runs again under the next epoch,
  // a fresh terminal wait is armed, and subscribers are told after the record reads running.
  selfResume(nodeId: string): void {
    const task = this.#byNode(nodeId)
    const epoch = task.record.notification.run_epoch + 1
    task.record = {
      ...task.record,
      status: "running",
      notification: { ...task.record.notification, run_epoch: epoch },
      resumed_run_epoch: epoch,
    }
    task.completion = deferred<TaskRecord>()
    for (const listener of [...(this.#selfResumed.get(task.record.task_id) ?? [])]) listener()
  }

  subscribeSelfResumed(taskId: string, listener: () => void): () => void {
    const listeners = this.#selfResumed.get(taskId) ?? new Set<() => void>()
    listeners.add(listener)
    this.#selfResumed.set(taskId, listeners)
    return () => listeners.delete(listener)
  }

  selfResumedListenerCount(): number {
    return [...this.#selfResumed.values()].reduce((count, listeners) => count + listeners.size, 0)
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    return task.completion.promise
  }

  // Answers as steering/controls.ts cancelTask does for the DAG's abort "skip": a fence naming an
  // earlier run is stale, and a finished child is a noop that stays resident and reopenable.
  async cancelTask(taskId: string, _reason?: string, options?: CancelOptions): Promise<CancelOutcome> {
    const record = this.get(taskId)
    if (record === undefined) throw new Error(`unknown fake task ${taskId}`)
    this.cancellations.push(String(record.owner?.nodeId))
    this.hooks.onCancel?.(String(record.owner?.nodeId))
    const { status, task_id } = record
    if (options?.expectedRunEpoch !== undefined && options.expectedRunEpoch !== record.notification.run_epoch) {
      return { kind: "stale", task_id, status, run_epoch: record.notification.run_epoch, reason: "earlier run" }
    }
    if (status !== "pending" && status !== "running" && status !== "paused") {
      return { kind: "noop", task_id, status, reason: `Task ${task_id} is ${status}, not running.` }
    }
    this.complete(String(record.owner?.nodeId), "cancelled")
    return { kind: "cancelled", task_id, previous_status: status }
  }

  sendToTask(input: SendInput): Promise<SendOutcome> {
    this.sends.push(input)
    const record = this.#tasks.get(input.idOrName)?.record
    if (record?.status !== "running") throw new Error(`fake send reached a ${record?.status ?? "missing"} task`)
    return Promise.resolve({ kind: "steered", task_id: record.task_id, status: "running", delivered: "followUp" })
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }
  findOwnedTask(owner: Pick<DagTaskOwner, "nodeId">): TaskRecord | undefined {
    return this.findOwnedTasks({ kind: "dag", nodeId: owner.nodeId }).at(0)
  }
  findOwnedTasks(scope: DagTaskOwnerScope): readonly TaskRecord[] {
    return ownedClaims(
      [...this.#tasks.values()].map((task) => task.record),
      scope,
    )
  }
  readonly residencyChanged = (): Promise<void> => new Promise<void>(() => undefined)
  readonly subscribeChild = (): (() => void) => () => undefined
  readonly start = notUsed
  readonly continueTask = notUsed
  readonly interruptTask = notUsed
  readonly list = (): readonly [] => []
  readonly forget = (): void => undefined
  readonly getResidentHandle = (): undefined => undefined
  readonly residentTaskIds = (): readonly string[] => []
  readonly promoteToBackground = (): boolean => false
  readonly wasBackground = (): boolean => true

  #put(nodeId: string, status: TaskStatus, owner: DagTaskOwner): Task {
    const record: TaskRecord = {
      task_id: `task-${nodeId}`,
      name: nodeId,
      parent_session_id: parentSessionId,
      root_session_id: "ses-root",
      depth: 1,
      category: "quick",
      execution_mode: "in-process",
      model: "fake-model",
      notify_on_terminal: true,
      owner,
      status,
      residency_state: "resident",
      created_at: "2026-11-26T00:00:00.000Z",
      updated_at: "2026-11-26T00:00:00.000Z",
      notification: { run_epoch: 1, notified_epoch: 0 },
    }
    const task: Task = { record, completion: deferred<TaskRecord>() }
    this.#tasks.set(record.task_id, task)
    return task
  }

  #byNode(nodeId: string): Task {
    const task = [...this.#tasks.values()].find((entry) => String(entry.record.owner?.nodeId) === nodeId)
    if (task === undefined) throw new Error(`unknown fake task for ${nodeId}`)
    return task
  }

  #signal(signals: Map<string, Signal>, nodeId: string): Signal {
    const existing = signals.get(nodeId)
    if (existing !== undefined) return existing
    const created: Signal = deferred()
    signals.set(nodeId, created)
    return created
  }
}

export function startFixture(
  initialRecord: DagRunRecordV1,
  taskManager: SelfResumingTaskManager,
  options: Pick<DagSchedulerOptions, "preAttachedTasks"> = {},
) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-self-resume-"))
  const store = createInMemoryDagStore(join(root, "senpi-task"))
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-11-26T00:00:01.000Z")
  const reservations = createDagRunReservations()
  const scheduler = createDagScheduler({
    reservations,
    store,
    taskManager,
    initialRecord,
    ...options,
    now: () => eventTime++,
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 500 }).events
  const cleanup = (): void => fs.rmSync(root, { recursive: true, force: true })
  // Subscribe before the trigger: resolves on the node's next transition into `to` (for `reason`, if named).
  const reaches = (nodeId: string, to: DagNodeState, reason?: string): Promise<void> => {
    const reached = deferred()
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== to) return
      if (reason !== undefined && event.reason.kind !== reason) return
      unsubscribe()
      reached.resolve()
    })
    return reached.promise
  }
  return { scheduler, events, reaches, cleanup }
}
