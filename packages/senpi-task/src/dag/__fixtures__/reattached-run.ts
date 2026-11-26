// The reattached-run fixture for DAG recovery tests: a run record whose nodes are already attached
// to children, and a task manager whose pre-existing child stays under the test's control.
import { makeHandle } from "../../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { ManagerStartSpec, TaskManager } from "../../manager/types"
import type { TaskRecord, TaskStatus } from "../../state"
import { compileDag, type DagDefinition } from "../graph"
import { subscribeDagJournal } from "../journal"
import type { DagRunRecordV1 } from "../manager"
import type { DagTaskOwner, OwnedStartResult } from "../owner"
import type { DagFileStore } from "../store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "../types"

type DagRunEventType = DagRunEvent["type"]

export const parentSessionId = "session-parent"
const rootSessionId = "session-root"
export const runId = "run-nonblocking-resume" as DagRunId

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

export function pausedRecord(
  input: DagDefinition,
  states: Readonly<Record<string, Partial<DagNode>>>,
): DagRunRecordV1 & { readonly previousLeaseHolderPid: number } {
  const createdAt = "2026-08-25T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("regression DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
    runKey: input.key,
    name: input.name,
    parentSessionId,
    rootSessionId,
    definitionFingerprint: "definition-fingerprint",
    definition: {
      key: input.key,
      name: input.name,
      nodes: input.nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })),
    },
    status: "paused",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes.map((entry) => ({ ...entry, ...states[String(entry.id)] })),
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
    previousLeaseHolderPid: 9001,
  }
}

export function taskRecord(owner: DagTaskOwner, status: TaskStatus, taskId = `task-${owner.nodeId}`): TaskRecord {
  return {
    task_id: taskId,
    name: String(owner.nodeId),
    parent_session_id: parentSessionId,
    root_session_id: rootSessionId,
    depth: 1,
    category: "quick",
    execution_mode: "in-process",
    model: "fake-model",
    notify_on_terminal: true,
    owner,
    status,
    residency_state: "resident",
    host_pid: 101,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:01.000Z",
    ...(status === "completed" ? { final_response: `done ${owner.nodeId}` } : {}),
    notification: { run_epoch: 1, notified_epoch: 0 },
  }
}

type MutableTask = {
  record: TaskRecord
  readonly completion: ReturnType<typeof deferred<TaskRecord>>
}

// Freshly dispatched children settle immediately; the pre-existing reattached child is under the
// test's manual control so it can keep running across the whole resume window, exactly like the
// production node that polled for 20+ minutes.
export class LongRunningTaskManager implements TaskManager {
  readonly startOwnedCalls: string[] = []
  readonly #tasks = new Map<string, MutableTask>()

  add(record: TaskRecord): void {
    const completion = deferred<TaskRecord>()
    this.#tasks.set(record.task_id, { record, completion })
    if (record.status !== "pending" && record.status !== "running") completion.resolve(record)
  }

  complete(taskId: string): void {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    task.record = { ...task.record, status: "completed", final_response: `done ${taskId}` }
    task.completion.resolve(task.record)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.startOwnedCalls.push(String(owner.nodeId))
    const existing = this.findOwnedTask(owner)
    if (existing !== undefined) {
      return {
        kind: "started",
        reused: true,
        task_id: existing.task_id,
        status: existing.status,
        name: existing.name ?? existing.task_id,
      }
    }
    const record = taskRecord(owner, "running")
    this.add(record)
    queueMicrotask(() => this.complete(record.task_id))
    return {
      kind: "started",
      reused: false,
      task_id: record.task_id,
      status: "running",
      name: record.name ?? record.task_id,
    }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find(
      ({ record }) =>
        record.owner?.kind === owner.kind && record.owner.runId === owner.runId && record.owner.nodeId === owner.nodeId,
    )?.record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    return task.completion.promise
  }

  start(): Promise<never> {
    throw new Error("not implemented")
  }
  continueTask(): Promise<never> {
    throw new Error("not implemented")
  }
  sendToTask(): Promise<never> {
    throw new Error("not implemented")
  }
  interruptTask(): Promise<never> {
    throw new Error("not implemented")
  }
  cancelTask(): Promise<never> {
    throw new Error("not implemented")
  }
  list(): readonly [] {
    return []
  }
  forget(_taskId: string, _options: Parameters<TaskManager["forget"]>[1]): void {}
  // The real manager settles `waitFor` only for a child it holds resident, so this fake answers
  // "held" from the same map its completions come from: a task it can still complete is held here.
  getResidentHandle(taskId: string): ManagedChildHandle | undefined {
    const record = this.#tasks.get(taskId)?.record
    if (record === undefined || (record.status !== "pending" && record.status !== "running")) return undefined
    return makeHandle(taskId).handle
  }
  subscribeChild(): () => void {
    return () => undefined
  }
  residentTaskIds(): readonly string[] {
    return []
  }
  residencyChanged(): Promise<void> {
    return new Promise<void>(() => undefined)
  }
  promoteToBackground(): boolean {
    return false
  }
  wasBackground(): boolean {
    return true
  }
}

export function owner(nodeId: string): DagTaskOwner {
  return { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: "unused-by-fake" }
}

/**
 * Resolves with the event types still missing once the run's journal has committed every awaited
 * type, or when the bounded deadline expires. Subscription happens BEFORE the action that produces
 * the events and every already-committed event is replayed from the WAL, so nothing can be missed;
 * the deadline exists only so a regressed engine reports WHICH boundary event never arrived instead
 * of dying on the suite timeout.
 */
export function awaitJournalEvents(
  store: DagFileStore,
  awaited: readonly DagRunEventType[],
  deadlineMs: number,
): { readonly missing: Promise<readonly DagRunEventType[]>; readonly stop: () => void } {
  const outstanding = new Set<DagRunEventType>(awaited)
  const settled = deferred<readonly DagRunEventType[]>()
  const observe = (type: DagRunEventType): void => {
    outstanding.delete(type)
    if (outstanding.size === 0) settled.resolve([])
  }
  const unsubscribe = subscribeDagJournal(store, runId, (event) => observe(event.type))
  for (const event of store.readEvents(runId, 0, { limit: 500 }).events) observe(event.type)
  const timer = setTimeout(() => settled.resolve([...outstanding]), deadlineMs)
  return {
    missing: settled.promise,
    stop: () => {
      clearTimeout(timer)
      unsubscribe()
    },
  }
}
