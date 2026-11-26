// The fake task manager and fixtures shared by the frontier-admission scheduler suites.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, DagTaskOwnerScope, OwnedStartResult } from "./owner"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunEvent, DagRunId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

export const runId = "run-frontier" as DagRunId
const parentSessionId = "ses-frontier-parent"
const rootSessionId = "ses-frontier-root"

const cleanupRoots: string[] = []

export function cleanupTempProjects(): void {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
}

export function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-frontier-"))
  cleanupRoots.push(directory)
  return directory
}

export function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

export function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "frontier-test", name: "frontier test", nodes }
}

function recordFor(input: DagDefinition, id: DagRunId = runId): DagRunRecordV1 {
  const createdAt = "2026-08-25T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId: id,
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
    status: "pending",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}

export function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export type FakeOptions = {
  readonly residencyLimit?: number
  // A slow start (task host busy): the admission batch stays in flight until this resolves.
  readonly beforeStart?: (nodeId: string, attempt: number) => Promise<void> | undefined
  // A contended session admission lease: the real acquisition is a bounded wait, modelled as one
  // macrotask so the scheduler's re-probe loop yields instead of spinning on microtasks.
  readonly leaseDenied?: (nodeId: string) => boolean
}

export class FrontierFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly attempts: string[] = []
  readonly denials: string[] = []
  readonly #options: FakeOptions
  readonly #tasks = new Map<
    string,
    {
      record: TaskRecord
      readonly completion: Promise<TaskRecord>
      readonly resolveCompletion: (record: TaskRecord) => void
    }
  >()
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
  readonly #deniedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
  // Session-scoped residency wake, mirroring the real manager: armed per parent session, fired
  // whenever a resident of that session settles (#8396).
  readonly #residencyWaiters = new Map<string, ReturnType<typeof deferred<void>>>()
  #taskCounter = 0

  constructor(options: FakeOptions = {}) {
    this.#options = options
  }

  whenStarted(nodeId: string): Promise<void> {
    let signal = this.#startedSignals.get(nodeId)
    if (signal === undefined) {
      signal = deferred<void>()
      this.#startedSignals.set(nodeId, signal)
    }
    if (this.starts.includes(nodeId)) signal.resolve()
    return signal.promise
  }

  whenDenied(nodeId: string): Promise<void> {
    let signal = this.#deniedSignals.get(nodeId)
    if (signal === undefined) {
      signal = deferred<void>()
      this.#deniedSignals.set(nodeId, signal)
    }
    if (this.denials.includes(nodeId)) signal.resolve()
    return signal.promise
  }

  residencyChanged(session: string): Promise<void> {
    let waiter = this.#residencyWaiters.get(session)
    if (waiter === undefined) {
      waiter = deferred<void>()
      this.#residencyWaiters.set(session, waiter)
    }
    return waiter.promise
  }

  #notifyResidency(session: string): void {
    const waiter = this.#residencyWaiters.get(session)
    if (waiter === undefined) return
    this.#residencyWaiters.delete(session)
    waiter.resolve()
  }

  recordOf(nodeId: string): TaskRecord | undefined {
    return [...this.#tasks.values()].find((entry) => String(entry.record.owner?.nodeId) === nodeId)?.record
  }

  complete(nodeId: string, status: TaskStatus = "completed"): void {
    const entry = [...this.#tasks.values()].find((candidate) => String(candidate.record.owner?.nodeId) === nodeId)
    if (entry === undefined) throw new Error(`unknown fake task for ${nodeId}`)
    entry.record = {
      ...entry.record,
      status,
      updated_at: "2026-08-25T00:00:01.000Z",
      ...(status === "completed" ? { final_response: `done ${nodeId}` } : { error_message: `${status} ${nodeId}` }),
    }
    entry.resolveCompletion(entry.record)
    this.#notifyResidency(entry.record.parent_session_id)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId)
    this.attempts.push(nodeId)
    await this.#options.beforeStart?.(nodeId, this.attempts.filter((attempt) => attempt === nodeId).length)
    if (this.#options.leaseDenied?.(nodeId) === true) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      this.denials.push(nodeId)
      this.#deniedSignals.get(nodeId)?.resolve()
      return { kind: "residency_denied", reason: "Residency admission lease was displaced.", cause: "lease" }
    }
    const existing = this.recordOf(nodeId)
    if (existing !== undefined) {
      return {
        kind: "started",
        reused: true,
        task_id: existing.task_id,
        status: existing.status,
        name: existing.name ?? existing.task_id,
      }
    }
    const limit = this.#options.residencyLimit ?? Number.POSITIVE_INFINITY
    const residents = [...this.#tasks.values()]
      .filter((entry) => entry.record.status === "pending" || entry.record.status === "running")
      .map((entry) => entry.record)
    if (residents.length >= limit) {
      this.denials.push(nodeId)
      this.#deniedSignals.get(nodeId)?.resolve()
      return {
        kind: "residency_denied",
        reason: "resident child cap reached",
        cause: "residents",
        max_children: limit,
        residents: residents.map((record) => ({
          task_id: record.task_id,
          name: record.name ?? record.task_id,
          status: record.status,
        })),
      }
    }
    this.#taskCounter += 1
    const taskId = `task-${this.#taskCounter}`
    const completion = deferred<TaskRecord>()
    this.#tasks.set(taskId, {
      record: {
        task_id: taskId,
        name: nodeId,
        parent_session_id: parentSessionId,
        root_session_id: rootSessionId,
        depth: 1,
        category: "quick",
        execution_mode: "in-process",
        model: "fake-model",
        notify_on_terminal: true,
        owner,
        status: "running",
        residency_state: "resident",
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:00:00.000Z",
        notification: { run_epoch: 1, notified_epoch: 0 },
      },
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    })
    this.starts.push(nodeId)
    this.#startedSignals.get(nodeId)?.resolve()
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: nodeId }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return this.recordOf(String(owner.nodeId))
  }

  findOwnedTasks(owner: DagTaskOwnerScope): readonly TaskRecord[] {
    if (owner.nodeId === undefined) {
      return [...this.#tasks.values()].map((entry) => entry.record).filter((task) => task.owner?.runId === owner.runId)
    }
    const record = this.findOwnedTask({
      kind: owner.kind,
      runId: owner.runId ?? ("*" as DagRunId),
      nodeId: owner.nodeId,
    })
    return record === undefined ? [] : [record]
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId)
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`)
    return entry.completion
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
  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }
  forget(_taskId: string, _options: Parameters<TaskManager["forget"]>[1]): void {}
  getResidentHandle(): undefined {
    return undefined
  }
  subscribeChild(): () => void {
    return () => undefined
  }
  residentTaskIds(): readonly string[] {
    return []
  }
  promoteToBackground(): boolean {
    return false
  }
  wasBackground(): boolean {
    return true
  }
}

export function frontierFixture(
  input: DagDefinition,
  manager: FrontierFakeManager,
  options: { readonly runId?: DagRunId; readonly store?: DagFileStore } = {},
) {
  const store = options.store ?? createDagFileStore(ownedTaskState(tempProject()))
  const id = options.runId ?? runId
  const initialRecord = recordFor(input, id)
  store.writeCheckpoint(id, initialRecord)
  let eventTime = Date.parse("2026-08-25T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(id, 0, { limit: 200 }).events
  return { scheduler, events, store }
}

type NodeTransition = Extract<DagRunEvent, { readonly type: "dag.node.transitioned" }>

// Resolves with the FIRST transition of the node the predicate accepts; subscribe before run().
export function whenNodeTransition(
  scheduler: ReturnType<typeof createDagScheduler>,
  nodeId: string,
  accept: (event: NodeTransition) => boolean,
): Promise<NodeTransition> {
  return new Promise<NodeTransition>((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || !accept(event)) return
      unsubscribe()
      resolve(event)
    })
  })
}

// Event-driven settle observation: resolves once the node reaches the state, never by sleeping.
export function whenNodeState(
  scheduler: ReturnType<typeof createDagScheduler>,
  nodeId: string,
  state: string,
): Promise<void> {
  const current = scheduler.snapshot().nodes.find((entry) => String(entry.id) === nodeId)
  if (current?.state === state) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== state) return
      unsubscribe()
      resolve()
    })
  })
}

// The bounded wait every case races its signal against: it rejects naming what never happened.
export function timeout(label: string): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error(`waited 5s for ${label}, it never happened`)), 5000).unref()
  })
}
