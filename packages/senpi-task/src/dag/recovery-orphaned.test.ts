// Regression for dag_5cf0bec7: a resumed run re-adopted every node whose task record still said
// `running`, without asking whether anything in the resuming host held that child. A daemon-hosted
// child parked at `rpc_detached` (its daemon gone) and a record still `resident` under a foreign pid
// both stayed `running` in the checkpoint for five generations, because `TaskManager.waitFor` only
// settles for a child THIS process holds - nothing could ever fold those nodes.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { makeHandle } from "../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunId } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "session-parent"
const rootSessionId = "session-root"
const runId = "run-orphaned-resume" as DagRunId
const HOST_PID = 101
const FOREIGN_PID = 9002

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
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-orphaned-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function pausedRecord(input: DagDefinition, states: Readonly<Record<string, Partial<DagNode>>>): DagRunRecordV1 {
  const createdAt = "2026-09-22T05:15:56.877Z"
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
    definition: { key: input.key, name: input.name, nodes: input.nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })) },
    status: "paused",
    generation: 4,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes.map((entry) => ({ ...entry, ...states[String(entry.id)] })),
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}

function owner(nodeId: string): DagTaskOwner {
  return { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: "unused-by-fake" }
}

function baseRecord(nodeId: string, status: TaskStatus): TaskRecord {
  return {
    task_id: `task-${nodeId}`,
    name: nodeId,
    parent_session_id: parentSessionId,
    root_session_id: rootSessionId,
    depth: 1,
    category: "quick",
    execution_mode: "process",
    model: "fake-model",
    notify_on_terminal: false,
    owner: owner(nodeId),
    status,
    residency_state: "resident",
    host_pid: HOST_PID,
    started_at: "2026-09-22T05:15:58.915Z",
    created_at: "2026-09-22T05:15:58.732Z",
    updated_at: "2026-09-22T05:16:43.058Z",
    notification: { run_epoch: 1, notified_epoch: -1 },
  }
}

/** The L1-thread-open shape: the daemon that hosted the child is gone, the lifecycle parked it. */
function parkedHostSessionRecord(nodeId: string): TaskRecord {
  const { host_pid: _hostPid, ...rest } = baseRecord(nodeId, "running")
  return {
    ...rest,
    residency_state: "rpc_detached",
    suspension_reason: "daemon_unavailable",
    runner_kind: "host-session",
    host_session: {
      socket: "/tmp/fake-rpc.sock",
      routing_id: "rpc-22",
      session_path: "/tmp/children/task-parked/session.jsonl",
      instance_id: "00811bb4-dead-instance",
    },
  }
}

/** The L7-quota-surfacing shape: still `resident` under a pid that is not this host. */
function foreignResidentRecord(nodeId: string): TaskRecord {
  return { ...baseRecord(nodeId, "running"), host_pid: FOREIGN_PID }
}

type MutableTask = { record: TaskRecord; readonly completion: ReturnType<typeof deferred<TaskRecord>> }

/**
 * A manager that distinguishes "has a record" from "holds the child": only ids in `held` answer
 * `getResidentHandle`, exactly the seam the real manager's `waitFor` settles through.
 */
class HoldingTaskManager implements TaskManager {
  readonly startOwnedCalls: string[] = []
  readonly waitForCalls: string[] = []
  // Resolves with the first id handed to `waitFor`. A settlement wait on a child this host does not
  // hold never resolves, so racing it against the resume turns that hang into an assertion.
  readonly firstWaitFor = deferred<string>()
  readonly #tasks = new Map<string, MutableTask>()
  readonly #handles = new Map<string, ManagedChildHandle>()
  #queuedLaunch: (() => void) | undefined

  add(record: TaskRecord, options: { readonly held?: boolean } = {}): void {
    const completion = deferred<TaskRecord>()
    this.#tasks.set(record.task_id, { record, completion })
    if (record.status !== "pending" && record.status !== "running") completion.resolve(record)
    if (options.held === true) this.#handles.set(record.task_id, makeHandle(record.task_id).handle)
  }

  complete(taskId: string): void {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    task.record = { ...task.record, status: "completed", final_response: `done ${taskId}` }
    this.#handles.delete(taskId)
    task.completion.resolve(task.record)
  }

  /** Runs the launch a queued (`pending`, handle-less) start deferred, like the concurrency lease. */
  launchQueued(): void {
    const launch = this.#queuedLaunch
    if (launch === undefined) throw new Error("no queued launch")
    this.#queuedLaunch = undefined
    launch()
  }

  async startOwned(_spec: ManagerStartSpec, ownerSpec: DagTaskOwner): Promise<OwnedStartResult> {
    this.startOwnedCalls.push(String(ownerSpec.nodeId))
    const record: TaskRecord = { ...baseRecord(String(ownerSpec.nodeId), "pending"), owner: ownerSpec }
    this.add(record)
    // Queued admission: the real manager returns `started/pending` with NO resident handle and
    // launches once a concurrency lease frees; the recovery gate must not read that as orphaned.
    this.#queuedLaunch = () => {
      const task = this.#tasks.get(record.task_id)
      if (task === undefined) return
      task.record = { ...task.record, status: "running" }
      this.#handles.set(record.task_id, makeHandle(record.task_id).handle)
      queueMicrotask(() => this.complete(record.task_id))
    }
    return { kind: "started", reused: false, task_id: record.task_id, status: "pending", name: record.name ?? record.task_id }
  }

  findOwnedTask(ownerKey: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find(({ record }) =>
      record.owner?.kind === ownerKey.kind && record.owner.runId === ownerKey.runId && record.owner.nodeId === ownerKey.nodeId,
    )?.record
  }

  get(taskId: string): TaskRecord | undefined { return this.#tasks.get(taskId)?.record }

  waitFor(taskId: string): Promise<TaskRecord> {
    this.waitForCalls.push(taskId)
    this.firstWaitFor.resolve(taskId)
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    return task.completion.promise
  }

  getResidentHandle(taskId: string): ManagedChildHandle | undefined { return this.#handles.get(taskId) }

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(): Promise<never> { throw new Error("not implemented") }
  interruptTask(): Promise<never> { throw new Error("not implemented") }
  cancelTask(): Promise<never> { throw new Error("not implemented") }
  list(): readonly [] { return [] }
  forget(): void {}
  subscribeChild(): () => void { return () => undefined }
  residentTaskIds(): readonly string[] { return [...this.#handles.keys()] }
  residencyChanged(): Promise<void> { return new Promise<void>(() => undefined) }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
}

describe("DAG resume liveness gate on running nodes", () => {
  test("#given running nodes whose children nobody in this host holds #when the session resumes #then they fail as resume_task_orphaned in the durable checkpoint instead of staying running", async () => {
    // given - the dag_5cf0bec7 checkpoint: two running nodes, one parked daemon child, one
    // foreign-resident child, and a dependent gate behind them
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new HoldingTaskManager()
    const input: DagDefinition = {
      key: "orphaned-resume",
      name: "orphaned resume",
      nodes: [node("parked"), node("foreign"), node("gate", ["parked", "foreign"])],
    }
    store.writeCheckpoint(runId, pausedRecord(input, {
      parked: { state: "running", taskId: "task-parked", attempt: 1 },
      foreign: { state: "running", taskId: "task-foreign", attempt: 1 },
      gate: { state: "pending" },
    }))
    manager.add(parkedHostSessionRecord("parked"))
    manager.add(foreignResidentRecord("foreign"))
    const reattached: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: HOST_PID,
      isProcessAlive: () => false,
      reattach: (_runId, taskId) => reattached.push(taskId),
    })

    // when
    const resume = recovery.resumePausedRuns(parentSessionId)
    const race = await Promise.race([
      resume.then(() => "resumed" as const),
      manager.firstWaitFor.promise.then((taskId) => `awaited-orphan:${taskId}` as const),
    ])
    expect(race).toBe("resumed")
    const [outcome] = await resume

    // then - the durable checkpoint, not the driver, says the nodes are failed with a reason
    const checkpoint = store.readCheckpoint<DagRunRecordV1>(runId)
    const parked = checkpoint?.nodes.find((entry) => entry.id === "parked")
    const foreign = checkpoint?.nodes.find((entry) => entry.id === "foreign")
    expect(outcome?.kind).toBe("resumed")
    expect(parked?.state).toBe("failed")
    expect(parked?.error?.code).toBe("resume_task_orphaned")
    expect(parked?.error?.message).toContain("task-parked")
    expect(parked?.error?.message).toContain("rpc_detached")
    expect(parked?.error?.message).toContain("daemon_unavailable")
    expect(foreign?.state).toBe("failed")
    expect(foreign?.error?.code).toBe("resume_task_orphaned")
    expect(foreign?.error?.message).toContain(`host_pid=${FOREIGN_PID}`)
    expect(checkpoint?.nodes.find((entry) => entry.id === "gate")?.state).toBe("skipped")
    expect(checkpoint?.status).toBe("failed")
    // and - nothing was handed to the scheduler to wait on forever
    expect(reattached).toEqual([])
    expect(manager.waitForCalls).toEqual([])
    const transitions = store.readEvents(runId, 0, { limit: 200 }).events
      .filter((event) => event.type === "dag.node.transitioned" && event.to === "failed")
      .map((event) => event.type === "dag.node.transitioned" ? `${event.nodeId}:${event.from}->${event.to}` : "")
    expect(transitions).toEqual(["parked:running->failed", "foreign:running->failed"])
  }, 30_000)

  test("#given a running node whose child this host holds #when the session resumes #then it is reattached and folds when the child settles", async () => {
    // given - control: the same record shape as the foreign case, but this host holds the handle
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new HoldingTaskManager()
    const input: DagDefinition = { key: "held-resume", name: "held resume", nodes: [node("held")] }
    store.writeCheckpoint(runId, pausedRecord(input, { held: { state: "running", taskId: "task-held", attempt: 1 } }))
    manager.add(baseRecord("held", "running"), { held: true })
    const reattached: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: HOST_PID,
      isProcessAlive: () => false,
      reattach: (_runId, taskId) => reattached.push(taskId),
    })

    // when
    const resume = recovery.resumePausedRuns(parentSessionId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.nodes[0]?.state).toBe("running")
    manager.complete("task-held")
    const [outcome] = await resume

    // then
    expect(reattached).toEqual(["task-held"])
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["held:completed"])
  }, 30_000)

  test("#given a never-started node whose recovery start is queued without a handle #when the session resumes #then the fresh child is not judged orphaned", async () => {
    // given - a scheduled node with no task: recovery starts it, and admission queues it (pending,
    // no resident handle yet) until a lease frees
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new HoldingTaskManager()
    const input: DagDefinition = { key: "queued-resume", name: "queued resume", nodes: [node("fresh")] }
    store.writeCheckpoint(runId, pausedRecord(input, { fresh: { state: "scheduled" } }))
    const recovery = createDagRecovery({ store, taskManager: manager, hostPid: HOST_PID, isProcessAlive: () => false })

    // when
    const resume = recovery.resumePausedRuns(parentSessionId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const midFlight = store.readCheckpoint<DagRunRecordV1>(runId)?.nodes[0]
    manager.launchQueued()
    const [outcome] = await resume

    // then
    expect(manager.startOwnedCalls).toEqual(["fresh"])
    expect(midFlight?.state).toBe("running")
    expect(midFlight?.error).toBeUndefined()
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["fresh:completed"])
  }, 30_000)
})
