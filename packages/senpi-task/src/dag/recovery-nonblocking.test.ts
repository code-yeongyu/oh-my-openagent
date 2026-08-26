// Regression for the dag_530ad299 session-restart stall: recovery used to block inside its
// reconcile loop awaiting a still-running reattached child, so `dag.run.resumed` and the reuse
// events of every node ordered after it never appeared and the run sat in `paused` for hours.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition } from "./graph"
import { subscribeDagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

type DagRunEventType = DagRunEvent["type"]

const cleanupRoots: string[] = []
const parentSessionId = "session-parent"
const rootSessionId = "session-root"
const runId = "run-nonblocking-resume" as DagRunId

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-nonblocking-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function pausedRecord(
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

function taskRecord(owner: DagTaskOwner, status: TaskStatus, taskId = `task-${owner.nodeId}`): TaskRecord {
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
class LongRunningTaskManager implements TaskManager {
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
    return { kind: "started", reused: false, task_id: record.task_id, status: "running", name: record.name ?? record.task_id }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find(({ record }) =>
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

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(): Promise<never> { throw new Error("not implemented") }
  interruptTask(): Promise<never> { throw new Error("not implemented") }
  cancelTask(): Promise<never> { throw new Error("not implemented") }
  list(): readonly [] { return [] }
  forget(): void {}
  getResidentHandle(): undefined { return undefined }
  subscribeChild(): () => void { return () => undefined }
  residentTaskIds(): readonly string[] { return [] }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
}

function owner(nodeId: string): DagTaskOwner {
  return { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: "unused-by-fake" }
}

/**
 * Resolves with the event types still missing once the run's journal has committed every awaited
 * type, or when the bounded deadline expires. Subscription happens BEFORE the action that produces
 * the events and every already-committed event is replayed from the WAL, so nothing can be missed;
 * the deadline exists only so a regressed engine reports WHICH boundary event never arrived instead
 * of dying on the suite timeout.
 */
function awaitJournalEvents(
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

describe("DAG resume without blocking on a reattached child", () => {
  test("#given a paused run whose first node is still running #when the session resumes #then reuse and dag.run.resumed land while that child keeps running", async () => {
    // given - the production checkpoint shape: the still-running node is ordered FIRST, so the old
    // blocking reconcile hit it before it ever emitted a reuse event for the completed sibling.
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = {
      key: "nonblocking-resume",
      name: "nonblocking resume",
      nodes: [node("slow"), node("done"), node("next", ["done"])],
    }
    store.writeCheckpoint(runId, pausedRecord(input, {
      slow: { state: "running", taskId: "task-slow", attempt: 1 },
      done: { state: "completed", taskId: "task-done", attempt: 1 },
      next: { state: "pending" },
    }))
    store.writeResult(runId, "done", "durable done output")
    manager.add(taskRecord(owner("slow"), "running", "task-slow"))
    const reattached: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => false,
      reattach: (_runId, taskId) => reattached.push(taskId),
    })
    const resumeBoundary = awaitJournalEvents(store, ["dag.node.reused", "dag.run.resumed"], 5_000)

    // when - resume runs while task-slow is NEVER completed during this window
    const resume = recovery.resumePausedRuns(parentSessionId)
    const missing = await resumeBoundary.missing
    resumeBoundary.stop()

    // then - the run left "paused" and reused durable work while the child is still running
    const midFlight = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(missing).toEqual([])
    expect(midFlight?.status).toBe("running")
    expect(midFlight?.nodes.find((entry) => entry.id === "slow")?.state).toBe("running")
    expect(manager.get("task-slow")?.status).toBe("running")
    expect(reattached).toContain("task-slow")

    // and then - the reattached child still folds through the normal wave await once it settles,
    // so the DagRecoveryOutcome contract survives unchanged.
    manager.complete("task-slow")
    const [outcome] = await resume
    expect(outcome?.kind).toBe("resumed")
    expect(outcome?.reusedOutputs?.get("done" as DagNodeId)).toBe("durable done output")
    expect(outcome?.record?.status).toBe("completed")
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`))
      .toEqual(["slow:completed", "done:completed", "next:completed"])
    expect(manager.startOwnedCalls).toEqual(["next"])
  }, 30_000)

  test("#given a scheduler built with pre-attached tasks #when a node is retried #then the fresh instance does not re-attach the settled child", async () => {
    // given - a run that already settled through a pre-attached reattachment, with one failed node
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = {
      key: "reentry-guard",
      name: "reentry guard",
      nodes: [node("reattached"), node("broken")],
    }
    const initialRecord = {
      ...pausedRecord(input, {
        reattached: { state: "completed", taskId: "task-reattached", attempt: 1, completedAt: "2026-08-25T00:00:02.000Z" },
        broken: { state: "failed", taskId: "task-broken", attempt: 1, completedAt: "2026-08-25T00:00:02.000Z" },
      }),
      status: "failed" as const,
    }
    store.writeCheckpoint(runId, initialRecord)
    store.writeResult(runId, "reattached", "durable reattached output")
    manager.add(taskRecord(owner("reattached"), "completed", "task-reattached"))
    const scheduler = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord,
      preAttachedTasks: new Map([["reattached" as DagNodeId, "task-reattached"]]),
    })

    // when - the settled run is re-entered through the retry verb
    const reentry = scheduler.retryNode(runId, ["broken" as DagNodeId])
    const record = await reentry.run

    // then - only the retried node is re-dispatched and the reattached node keeps ONE completion
    expect(manager.startOwnedCalls).toEqual(["broken"])
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`))
      .toEqual(["reattached:completed", "broken:completed"])
    const reattachedTransitions = store.readEvents(runId, 0, { limit: 500 }).events
      .filter((event) => event.type === "dag.node.transitioned" && event.nodeId === "reattached")
    expect(reattachedTransitions).toEqual([])
  }, 30_000)
})
