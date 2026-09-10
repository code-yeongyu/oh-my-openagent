// allow: SIZE_OK - restart recovery needs one acceptance fixture spanning leases, task ownership, artifacts, and wave continuation.
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskLifecycle } from "../lifecycle"
import { FakeRegistry } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { categoryPlanner, makeHandle, settings } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import type { ManagerStartSpec, TaskManager } from "../manager/types"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import type { RpcChildHandle } from "../runners/types"
import { createTaskRecord, markRecordLostForReconciliation, type TaskRecord, type TaskStatus } from "../state"
import { createTaskRecordStore } from "../store"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

const cleanupRoots: string[] = []
const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "error", "cancelled", "interrupted", "lost"])
const parentSessionId = "session-parent"
const rootSessionId = "session-root"
const runId = "run-recovery" as DagRunId

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "recovery-test", name: "recovery test", nodes }
}

function recoverableRecord(
  input: DagDefinition,
  states: Readonly<Record<string, Partial<DagNode>>>,
  overrides: Partial<DagRunRecordV1> & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number } = {},
): DagRunRecordV1 {
  const createdAt = "2026-08-14T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  const record: DagRunRecordV1 = {
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
    ...overrides,
  }
  return record
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
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:01.000Z",
    ...(status === "completed" ? { final_response: `done ${owner.nodeId}` } : {}),
    ...(status === "lost" ? { error_message: "previous-process in-process" } : {}),
    notification: { run_epoch: 1, notified_epoch: 0 },
  }
}

type MutableTask = {
  record: TaskRecord
  readonly completion: ReturnType<typeof deferred<TaskRecord>>
}

class RecoveryTaskManager implements TaskManager {
  readonly startOwnedCalls: string[] = []
  readonly ownerFingerprints: string[] = []
  readonly waitForCalls: string[] = []
  readonly #tasks = new Map<string, MutableTask>()
  readonly #autoCompleteStarts: boolean

  constructor(options: { readonly autoCompleteStarts?: boolean } = {}) {
    this.#autoCompleteStarts = options.autoCompleteStarts !== false
  }

  add(record: TaskRecord): void {
    const completion = deferred<TaskRecord>()
    this.#tasks.set(record.task_id, { record, completion })
    if (record.status !== "pending" && record.status !== "running") completion.resolve(record)
  }

  complete(taskId: string, status: TaskStatus = "completed"): void {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    task.record = {
      ...task.record,
      status,
      updated_at: "2026-08-14T00:00:03.000Z",
      ...(status === "completed" ? { final_response: `done ${task.record.owner?.nodeId ?? taskId}` } : {}),
    }
    task.completion.resolve(task.record)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.startOwnedCalls.push(String(owner.nodeId))
    this.ownerFingerprints.push(owner.fingerprint)
    const existing = this.findOwnedTask(owner)
    // Match TaskManager.#ownedResult: same fingerprint reuses even terminal records;
    // a different fingerprint replaces only a terminal owner, never a live one.
    if (existing !== undefined) {
      if (existing.owner?.fingerprint === owner.fingerprint) {
        return { kind: "started", reused: true, task_id: existing.task_id, status: existing.status, name: existing.name ?? existing.task_id }
      }
      if (!TERMINAL_TASK_STATUSES.has(existing.status)) {
        return {
          kind: "owner_conflict",
          task_id: existing.task_id,
          existing_fingerprint: existing.owner?.fingerprint ?? "",
          requested_fingerprint: owner.fingerprint,
        }
      }
    }
    const record = taskRecord(owner, "running")
    this.add(record)
    if (this.#autoCompleteStarts) queueMicrotask(() => this.complete(record.task_id))
    return { kind: "started", reused: false, task_id: record.task_id, status: "running", name: record.name ?? record.task_id }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].findLast(({ record }) =>
      record.owner?.kind === owner.kind && record.owner.runId === owner.runId && record.owner.nodeId === owner.nodeId,
    )?.record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    this.waitForCalls.push(taskId)
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

function owner(nodeId: string, execAttempt?: number): DagTaskOwner {
  return {
    kind: "dag",
    runId,
    nodeId: nodeId as DagNodeId,
    fingerprint: dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: "definition-fingerprint",
      nodeId: nodeId as DagNodeId,
      ...(execAttempt === undefined ? {} : { execAttempt }),
    })),
  }
}

function events(store: DagFileStore): readonly DagRunEvent[] {
  return store.readEvents(runId, 0, { limit: 100 }).events
}

describe("RecoveryTaskManager owner identity", () => {
  test.each(["pending", "running", "completed", "error", "cancelled", "interrupted", "lost"] as const)("#given an owned %s record #when startOwned compares fingerprints #then it reuses identical owners and replaces only settled differing owners", async (status) => {
    const manager = new RecoveryTaskManager({ autoCompleteStarts: false })
    const priorOwner = owner("owned")
    manager.add(taskRecord(priorOwner, status, "task-owned-prev"))
    const spec: ManagerStartSpec = { prompt: "do owned", parent_session_id: parentSessionId, depth: 1 }

    const same = await manager.startOwned(spec, priorOwner)
    expect(same).toMatchObject({ kind: "started", reused: true, task_id: "task-owned-prev", status })

    const nextOwner = owner("owned", 1)
    const different = await manager.startOwned(spec, nextOwner)
    if (status === "pending" || status === "running") {
      expect(different).toEqual({
        kind: "owner_conflict",
        task_id: "task-owned-prev",
        existing_fingerprint: priorOwner.fingerprint,
        requested_fingerprint: nextOwner.fingerprint,
      })
    } else {
      expect(different).toMatchObject({ kind: "started", reused: false, task_id: "task-owned", status: "running" })
      expect(manager.findOwnedTask(nextOwner)?.owner?.fingerprint).toBe(nextOwner.fingerprint)
    }
  })
})

describe("DAG crash recovery", () => {
  test("#given a paused run after wave one #when the session restarts #then completed work is reused, the running child folds, and the incomplete wave resumes", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    const input = definition([node("done"), node("running"), node("next", ["done", "running"])])
    const record = recoverableRecord(input, {
      done: { state: "completed", taskId: "task-done", attempt: 1 },
      running: { state: "running", taskId: "task-running", attempt: 1 },
      next: { state: "blocked" },
    }, { previousLeaseHolderPid: 9001 })
    store.writeCheckpoint(runId, record)
    store.writeResult(runId, "done", "durable done output")
    manager.add(taskRecord(owner("running"), "running", "task-running"))
    const reattached: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: (pid) => pid === 101,
      reattach: (_claimedRunId, taskId) => reattached.push(taskId),
      now: () => Date.parse("2026-08-14T00:00:04.000Z"),
    })
    queueMicrotask(() => manager.complete("task-running"))

    // when
    const outcomes = await recovery.resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.kind).toBe("resumed")
    expect(outcomes[0]?.reusedOutputs?.get("done" as DagNodeId)).toBe("durable done output")
    expect(manager.startOwnedCalls).toEqual(["next"])
    expect(manager.startOwnedCalls).not.toContain("done")
    expect(manager.startOwnedCalls).not.toContain("running")
    expect(manager.waitForCalls).toContain("task-running")
    expect(reattached).toContain("task-running")
    expect(outcomes[0]?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`))
      .toEqual(["done:completed", "running:completed", "next:completed"])
    expect(events(store).some((event) => event.type === "dag.node.reused" && event.nodeId === "done")).toBe(true)
    expect(events(store).some((event) => event.type === "dag.run.resumed")).toBe(true)
  })

  test("#given no injected liveness probe #when a paused run's previous holder is this live process #then the default probe skips it as a live lease", async () => {
    // given - the default probe is the lifecycle port's signal-0 existence check, so THIS pid reads alive
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("only")]), {
      only: { state: "scheduled" },
    }, { previousLeaseHolderPid: process.pid }))

    // when
    const outcomes = await createDagRecovery({ store, taskManager: new RecoveryTaskManager(), hostPid: 101 })
      .resumePausedRuns(parentSessionId)

    // then - the live holder is reported so the caller can wait for that pid to exit and retry
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: process.pid }])
  })

  test("#given no injected liveness probe #when a paused run's previous holder pid does not exist #then the default probe claims the run", async () => {
    // given - 2_147_483_647 is above every reachable pid, so the signal-0 probe reports it dead
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("only")]), {
      only: { state: "scheduled" },
    }, { previousLeaseHolderPid: 2_147_483_647 }))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101 })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.kind).toBe("resumed")
    expect(manager.startOwnedCalls).toEqual(["only"])
  })

  test("#given a paused own-session run whose previous holder is THIS host pid and no in-process holder is registered #when the same host resumes the session #then it is claimed and resumed instead of waiting on itself", async () => {
    // given - the probe says EVERY pid is alive: a signal-0 probe on our own pid is always true, so the
    // claim must be decided by identity, not liveness (#8006 saved-session reopen in one host process)
    const store = createDagFileStore({ project_dir: tempProject() })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("only")]), {
      only: { state: "scheduled" },
    }, { previousLeaseHolderPid: 101 }))

    // when
    const outcomes = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => true })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ runId, kind: "resumed" })
    expect(manager.startOwnedCalls).toEqual(["only"])
    expect(events(store).some((event) => event.type === "dag.run.resumed")).toBe(true)
    const settled = store.readCheckpoint<DagRunRecordV1 & { readonly leaseHolderPid?: number }>(runId)
    expect(settled?.status).toBe("completed")
    expect(settled?.leaseHolderPid).toBeUndefined()
  })

  test("#given a paused own-session run whose previous holder is THIS host pid #when this process still schedules the run #then it is skipped as live_lease naming our own pid", async () => {
    // given - the same-runtime pause + re-attach: the original scheduler is still registered in this
    // process, and a recovery-built second scheduler would fold the same children twice
    const store = createDagFileStore({ project_dir: tempProject() })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("only")]), {
      only: { state: "scheduled" },
    }, { previousLeaseHolderPid: 101 }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => true,
      isRunHeldInProcess: () => true,
    }).resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: 101 }])
    expect(manager.startOwnedCalls).toEqual([])
    expect(events(store).some((event) => event.type === "dag.run.resumed")).toBe(false)
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("paused")
  })

  test("#given scheduled nodes with and without durable owners #when resumed #then the owner is attached and only never-dispatched work starts", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("owned"), node("fresh")]), {
      owned: { state: "scheduled" },
      fresh: { state: "scheduled" },
    }, { previousLeaseHolderPid: 9001 }))
    manager.add(taskRecord(owner("owned"), "completed", "task-owned"))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(manager.startOwnedCalls).toEqual(["fresh"])
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.taskId}:${entry.state}`))
      .toEqual(["owned:task-owned:completed", "fresh:task-fresh:completed"])
  })

  test("#given an attached node whose task, owner, result, and transcript vanished #when resumed #then it fails closed without dispatch", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("uncertain")]), {
      uncertain: { state: "running", taskId: "task-missing", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.record?.nodes[0]?.state).toBe("failed")
    expect(outcome?.record?.nodes[0]?.error?.code).toBe("resume_task_missing")
    expect(manager.startOwnedCalls).toEqual([])
  })

  test("#given reconcile marked an in-process child lost #when its paused DAG resumes #then task_lost is folded and never re-dispatched", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("lost")]), {
      lost: { state: "running", taskId: "task-lost", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    manager.add(taskRecord(owner("lost"), "lost", "task-lost"))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.record?.nodes[0]?.state).toBe("failed")
    expect(outcome?.record?.nodes[0]?.error?.code).toBe("task_lost")
    expect(manager.startOwnedCalls).toEqual([])
  })

  test.each([undefined, 1])("#given a never-started lost child at execAttempt %s #when its paused DAG resumes #then a new owner fingerprint dispatches a fresh attempt", async (execAttempt) => {
    // given - the lost record has no task-level launch stamp. Its persisted owner identity
    // must match the checkpoint's execAttempt so forgetting the bump would reuse the lost task.
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("queued")]), {
      queued: { state: "scheduled", taskId: "task-queued-prev", attempt: 1, ...(execAttempt === undefined ? {} : { execAttempt }) },
    }, { previousLeaseHolderPid: 9001 }))
    const priorOwner = owner("queued", execAttempt)
    const lost = taskRecord(priorOwner, "lost", "task-queued-prev")
    expect(lost).not.toHaveProperty("started_at")
    manager.add(lost)

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then - the never-started node is dispatched as attempt 2 instead of failing the run
    expect(outcome?.kind).toBe("resumed")
    expect(outcome?.record?.status).toBe("completed")
    expect(outcome?.record?.nodes[0]).toMatchObject({ state: "completed", taskId: "task-queued", attempt: 2 })
    expect(manager.startOwnedCalls).toEqual(["queued"])
    expect(manager.ownerFingerprints).toEqual([owner("queued", (execAttempt ?? 0) + 1).fingerprint])
    expect(manager.ownerFingerprints[0]).not.toBe(priorOwner.fingerprint)
    expect(manager.findOwnedTask(priorOwner)?.task_id).toBe("task-queued")
    expect(events(store).some((event) => event.type === "dag.node.retried" &&
      event.nodeId === "queued" &&
      event.priorTaskId === "task-queued-prev" &&
      event.execAttempt === (execAttempt ?? 0) + 1)).toBe(true)
  })

  test("#given a paused run with one in-flight and one queued node lost by the dead process #when resumed #then only the in-flight node fails task_lost and the queued node runs fresh", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("inflight"), node("queued")]), {
      inflight: { state: "running", taskId: "task-inflight", attempt: 1 },
      queued: { state: "scheduled", taskId: "task-queued-prev", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    const inflight = { ...taskRecord(owner("inflight"), "lost", "task-inflight"), started_at: "2026-08-14T00:00:01.000Z" }
    manager.add(inflight)
    const priorOwner = owner("queued")
    const queued = taskRecord(priorOwner, "lost", "task-queued-prev")
    expect(queued).not.toHaveProperty("started_at")
    manager.add(queued)

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then - the run fails solely through the genuinely in-flight node; the queued node completes
    expect(outcome?.kind).toBe("resumed")
    expect(outcome?.record?.status).toBe("failed")
    const nodes = new Map(outcome?.record?.nodes.map((entry) => [entry.id as string, entry]))
    expect(nodes.get("inflight")).toMatchObject({ state: "failed", taskId: "task-inflight" })
    expect(nodes.get("inflight")?.error?.code).toBe("task_lost")
    expect(nodes.get("queued")).toMatchObject({ state: "completed", taskId: "task-queued", attempt: 2 })
    expect(manager.startOwnedCalls).toEqual(["queued"])
    expect(manager.ownerFingerprints).toEqual([owner("queued", 1).fingerprint])
    expect(manager.ownerFingerprints[0]).not.toBe(priorOwner.fingerprint)
  })

  test("#given a lost child with started_at but a still-scheduled DAG node #when resumed across the admission batch crash gap #then task_lost is folded without readmission", async () => {
    // given - TaskManager persisted start before runner.start; the owner died before the
    // scheduler's whole admission batch settled and attached the running task to its node.
    const store = createDagFileStore({ project_dir: tempProject() })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("launched")]), {
      launched: { state: "scheduled", attempt: 0 },
    }, { previousLeaseHolderPid: 9001 }))
    const lost = {
      ...taskRecord(owner("launched"), "lost", "task-launched"),
      started_at: "2026-08-14T00:00:01.000Z",
    }
    expect(lost.pid).toBeUndefined()
    expect(lost.child_session_id).toBeUndefined()
    manager.add(lost)

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.record?.status).toBe("failed")
    expect(outcome?.record?.nodes[0]).toMatchObject({ state: "failed", taskId: "task-launched", error: { code: "task_lost" } })
    expect(manager.startOwnedCalls).toEqual([])
    expect(events(store).some((event) => event.type === "dag.node.retried")).toBe(false)
  })

  test.each([
    { status: "lost", launched: true },
    { status: "completed", launched: true },
    { status: "lost", launched: false },
  ] as const)("#given a retained prior-attempt taskId and a newer %o owner #when resumed #then recovery uses the selected owner's outcome and retry identity", async ({ status, launched }) => {
    // given - retried kept the old taskId until the replacement's admission batch attaches it.
    const store = createDagFileStore({ project_dir: tempProject() })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("replacement")]), {
      replacement: { state: "scheduled", taskId: "task-old", attempt: 1, execAttempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    manager.add(taskRecord(owner("replacement"), "lost", "task-old"))
    const replacement = {
      ...taskRecord(owner("replacement", 1), status, "task-new"),
      created_at: "2026-08-14T00:00:02.000Z",
      ...(launched ? { started_at: "2026-08-14T00:00:03.000Z" } : {}),
    }
    manager.add(replacement)
    expect(manager.findOwnedTask(owner("replacement", 1))).toEqual(replacement)

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    if (launched) {
      expect(outcome?.record?.nodes[0]).toMatchObject({
        state: status === "lost" ? "failed" : "completed", taskId: "task-new", execAttempt: 1,
        ...(status === "lost" ? { error: { code: "task_lost" } } : {}),
      })
      expect(manager.startOwnedCalls).toEqual([])
      expect(events(store).some((event) => event.type === "dag.node.retried")).toBe(false)
    } else {
      expect(outcome?.record?.nodes[0]).toMatchObject({ state: "completed", taskId: "task-replacement", execAttempt: 2 })
      expect(manager.startOwnedCalls).toEqual(["replacement"])
      expect(manager.ownerFingerprints).toEqual([owner("replacement", 2).fingerprint])
      expect(events(store).filter((event) => event.type === "dag.node.retried")).toEqual([
        expect.objectContaining({ nodeId: "replacement", priorTaskId: "task-new", execAttempt: 2 }),
      ])
    }
  })

  test.each(["switch-cancelled", "continuation-failed"] as const)("#given legacy respawn fails after launch with %s #when its scheduled DAG recovers #then persisted launch evidence prevents another execution", async (failure) => {
    // given - real manager ports stamp launch before the RPC runner; legacy reconciliation owns loss.
    const project = tempProject()
    const taskStore = createTaskRecordStore({ project_dir: project })
    const pending: TaskRecord = {
      ...createTaskRecord({
        parent_session_id: parentSessionId, root_session_id: rootSessionId, depth: 1,
        execution_mode: "process", model: "fake-model", notify_on_terminal: false, owner: owner("respawned"),
      }, Date.parse("2026-08-14T00:00:00.000Z")),
      pid: 9001,
      spawn_spec: { version: 1, cwd: project, prompt: "do respawned" },
    }
    taskStore.save(pending)
    const sessionDir = resolveChildSessionDir(join(taskStore.stateDir, "children", pending.task_id), pending.task_id)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(join(sessionDir, "session.jsonl"), `${JSON.stringify({ type: "message", message: { role: "user", content: "continue" } })}\n`)
    const now = () => Date.parse("2026-08-14T00:00:01.000Z")
    const config = settings()
    const launchObservations: Array<TaskRecord | null> = []
    const calls: string[] = []
    const handle: RpcChildHandle = {
      ...makeHandle(pending.task_id).handle,
      pid: 9002,
      subscribe: () => () => undefined,
      waitForIdle: async () => undefined,
      terminate: async () => { calls.push("terminate") },
      dispose: async () => { calls.push("dispose") },
      exitOutcome: () => undefined,
      waitForExit: async () => ({ kind: "clean", facts: { pid: 9002, code: 0, signal: null, stderrTail: "" } }),
      lastSeen: () => undefined,
      switchSession: async () => { calls.push("switch"); return { cancelled: failure === "switch-cancelled" } },
      followUp: async () => { calls.push("continue"); throw new Error("injected continuation failure") },
    }
    const runner = { start: async () => { throw new Error("unexpected fresh launch") } }
    createTaskManager({
      store: taskStore, runners: { "in-process": runner, process: runner },
      rpcRespawnRunner: { start: async () => {
        launchObservations.push(createTaskRecordStore({ project_dir: project }).load(pending.task_id))
        taskStore.mutate(pending.task_id, (fresh) => ({ ...fresh, child_session_id: handle.sessionId }))
        return handle
      } },
      planner: categoryPlanner(), config, cwd: project, hostPid: 101, now,
    })
    const lifecycle = createTaskLifecycle({
      store: taskStore, registry: new FakeRegistry(), config, hostPid: 101, now,
      signaller: { isAlive: () => false, signal: () => { throw new Error("unexpected signal") } },
    })

    // when - no scoped parent: exercise the legacy global sweep and its failed-respawn branch.
    const reconciled = await lifecycle.reconcileOnSessionStart()
    lifecycle.dispose?.()
    const lost = createTaskRecordStore({ project_dir: project }).load(pending.task_id)
    if (lost === null) throw new Error("expected persisted lost task")
    expect(reconciled.outcomes).toContainEqual(expect.objectContaining({ task_id: pending.task_id, kind: "lost" }))
    expect(lost.status).toBe("lost")
    const manager = new RecoveryTaskManager()
    manager.add(lost)
    const store = createDagFileStore({ project_dir: project })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("respawned")]), {
      respawned: { state: "scheduled" },
    }, { previousLeaseHolderPid: 101 }))
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 202, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then - both the store and DAG observe the same launched/lost task, never a fresh attempt.
    expect(launchObservations).toHaveLength(1)
    expect(launchObservations[0]?.started_at).toBe(new Date(now()).toISOString())
    expect(calls).toEqual(failure === "switch-cancelled" ? ["switch", "terminate", "dispose"] : ["switch", "continue", "terminate", "dispose"])
    expect(lost).toMatchObject({ started_at: new Date(now()).toISOString(), child_session_id: handle.sessionId, residency_state: "disposed" })
    expect(outcome?.record?.nodes[0]).toMatchObject({ state: "failed", taskId: pending.task_id, error: { code: "task_lost" } })
    expect(manager.startOwnedCalls).toEqual([])
    expect(events(store).some((event) => event.type === "dag.node.retried")).toBe(false)
  })

  test("#given a pending child freshly launched by scoped lifecycle recovery #when lost while its DAG node is still scheduled #then the persisted launch folds task_lost without dispatch", async () => {
    // given - use the real lifecycle ports, manager and record store, not a hand-stamped record.
    const project = tempProject()
    const taskStore = createTaskRecordStore({ project_dir: project })
    const pending = {
      ...createTaskRecord({
        parent_session_id: parentSessionId, root_session_id: rootSessionId, depth: 1,
        execution_mode: "in-process", model: "fake-model", notify_on_terminal: false,
        owner: owner("revived"),
      }, Date.parse("2026-08-14T00:00:00.000Z")),
      residency_state: "persisted_only" as const,
      spawn_spec: { version: 1 as const, cwd: project, prompt: "do revived" },
    }
    taskStore.save(pending)
    const now = () => Date.parse("2026-08-14T00:00:01.000Z")
    const config = settings()
    const launchObservations: Array<TaskRecord | null> = []
    const runner = { start: async () => {
      launchObservations.push(createTaskRecordStore({ project_dir: project }).load(pending.task_id))
      return makeHandle(pending.task_id).handle
    } }
    createTaskManager({
      store: taskStore, runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(), config, cwd: project, hostPid: 101, now,
    })
    const lifecycle = createTaskLifecycle({ store: taskStore, registry: new FakeRegistry(), config, hostPid: 101, now })
    const revived = await lifecycle.reconcileOnSessionStart(parentSessionId)
    lifecycle.dispose?.()
    expect(revived.outcomes).toContainEqual(expect.objectContaining({ task_id: pending.task_id, kind: "resumed" }))
    taskStore.mutate(pending.task_id, (fresh) => markRecordLostForReconciliation(fresh, {
      timestamp: "2026-08-14T00:00:02.000Z", error_message: "host died",
    }).record)
    const lost = createTaskRecordStore({ project_dir: project }).load(pending.task_id)
    if (lost === null) throw new Error("expected persisted lost task")
    expect(lost.status).toBe("lost")
    const manager = new RecoveryTaskManager()
    manager.add(lost)
    const store = createDagFileStore({ project_dir: project })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("revived")]), {
      revived: { state: "scheduled" },
    }, { previousLeaseHolderPid: 101 }))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 202, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.record?.nodes[0]).toMatchObject({ state: "failed", error: { code: "task_lost" } })
    expect(manager.startOwnedCalls).toEqual([])
    expect(events(store).some((event) => event.type === "dag.node.retried")).toBe(false)
    expect(launchObservations).toHaveLength(1)
    expect(launchObservations[0]?.started_at).toBe(new Date(now()).toISOString())
    expect(lost.started_at).toBe(new Date(now()).toISOString())
  })

  test.each([2, 3, 4])("#given a never-started lost node at execAttempt %s #when resumed #then automatic readmission stops at the execution-attempt cap", async (execAttempt) => {
    // given - display attempt is deliberately unrelated to the persisted execution counter.
    const store = createDagFileStore({ project_dir: tempProject() })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("queued")]), {
      queued: { state: "scheduled", taskId: "task-queued-prev", attempt: 9, execAttempt },
    }, { previousLeaseHolderPid: 9001 }))
    manager.add(taskRecord(owner("queued", execAttempt), "lost", "task-queued-prev"))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    if (execAttempt < 3) {
      expect(outcome?.record?.status).toBe("completed")
      expect(outcome?.record?.nodes[0]).toMatchObject({ state: "completed", attempt: 10, execAttempt: 3 })
      expect(manager.ownerFingerprints).toEqual([owner("queued", 3).fingerprint])
    } else {
      expect(outcome?.record?.status).toBe("failed")
      expect(outcome?.record?.nodes[0]).toMatchObject({ state: "failed", execAttempt, error: { code: "task_lost" } })
      expect(manager.startOwnedCalls).toEqual([])
      expect(events(store).some((event) => event.type === "dag.node.retried")).toBe(false)
    }
  })

  test("#given a paused run owned by a dead foreign session #when its fork adopts it #then the resume is journaled on the run's own ledger", async () => {
    // given - this exact configuration used to pin the orphaning as correct (skipped, still
    // paused); adoption retargets it to the journal contract: an adopted run carries a real
    // dag.run.resumed event, not just a rewritten checkpoint.
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("foreign")]), {}, {
      parentSessionId: "foreign-session",
      previousLeaseHolderPid: 9001,
    }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId, "foreign-session")

    // then
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["adopted"])
    expect(store.readEvents(runId, 0, { limit: 256 }).events.map((event) => event.type)).toContain("dag.run.resumed")
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.status).not.toBe("paused")
  })

  test("#given two managers race a paused run #when the first claim holder is live #then exactly one resumes and the other observes the live lease", async () => {
    // given
    const projectDir = tempProject()
    const storeA = createDagFileStore({ project_dir: projectDir })
    const storeB = createDagFileStore({ project_dir: projectDir })
    const input = definition([node("active")])
    storeA.writeCheckpoint(runId, recoverableRecord(input, {
      active: { state: "running", taskId: "task-active", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    const managerA = new RecoveryTaskManager({ autoCompleteStarts: false })
    const managerB = new RecoveryTaskManager({ autoCompleteStarts: false })
    managerA.add(taskRecord(owner("active"), "running", "task-active"))
    managerB.add(taskRecord(owner("active"), "running", "task-active"))
    const alive = (pid: number) => pid === 101 || pid === 202
    const recoveryA = createDagRecovery({ store: storeA, taskManager: managerA, hostPid: 101, isProcessAlive: alive })
    const recoveryB = createDagRecovery({ store: storeB, taskManager: managerB, hostPid: 202, isProcessAlive: alive })

    // when
    const first = recoveryA.resumePausedRuns(parentSessionId)
    const second = recoveryB.resumePausedRuns(parentSessionId)
    managerA.complete("task-active")
    managerB.complete("task-active")
    const [outcomesA, outcomesB] = await Promise.all([first, second])

    // then
    expect(outcomesA.filter((outcome) => outcome.kind === "resumed")).toHaveLength(1)
    expect(outcomesB).toEqual([{ runId, kind: "skipped", reason: "live_lease", holderPid: 101 }])
  })

  test("#given a crash after a terminal transition reaches the WAL but before its reducer #when recovery reopens #then output artifact metadata and run stats are rebuilt", async () => {
    // given
    const projectDir = tempProject()
    const baseStore = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    const completed = {
      ...taskRecord(owner("wal-artifact"), "completed", "task-wal-artifact"),
      final_response: "wal boundary output",
      run_stats: { runtime_ms: 47, turns: 4, tool_calls: 3, output_tokens: 19 },
    }
    manager.add(completed)
    baseStore.writeCheckpoint(runId, recoverableRecord(definition([node("wal-artifact")]), {
      "wal-artifact": { state: "running", taskId: "task-wal-artifact", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    let crashAfterTerminalWal = true
    const crashingStore: DagFileStore = {
      ...baseStore,
      appendEvent(event) {
        baseStore.appendEvent(event)
        if (crashAfterTerminalWal && event.type === "dag.node.transitioned" && event.to === "completed") {
          crashAfterTerminalWal = false
          throw new Error("injected crash after terminal WAL append")
        }
      },
    }

    // when
    await expect(createDagRecovery({
      store: crashingStore,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId)).rejects.toThrow("injected crash after terminal WAL append")
    const reopenedStore = createDagFileStore({ project_dir: projectDir })
    const [outcome] = await createDagRecovery({
      store: reopenedStore,
      taskManager: manager,
      hostPid: 202,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId)

    // then
    const checkpoint = reopenedStore.readCheckpoint<DagRunRecordV1 & {
      readonly nodes: readonly (DagNode & {
        readonly resultArtifact?: {
          readonly relativePath: string
          readonly sha256: string
          readonly bytes: number
          readonly stats?: { readonly relativePath: string; readonly sha256: string; readonly bytes: number }
        }
      })[]
    }>(runId)
    const recovered = checkpoint?.nodes[0]
    const artifact = recovered?.resultArtifact
    const statsPath = reopenedStore.paths.result(runId, "wal-artifact").replace(/\.txt$/, ".stats.json")
    const statsRaw = fs.readFileSync(statsPath, "utf8")
    expect(outcome?.kind).toBe("resumed")
    expect(recovered?.state).toBe("completed")
    expect(reopenedStore.readResult(runId, "wal-artifact")).toBe("wal boundary output")
    expect(recovered?.runStats).toEqual(completed.run_stats)
    expect(artifact).toEqual({
      relativePath: join("dag", "results", runId, "wal-artifact.txt"),
      sha256: createHash("sha256").update("wal boundary output").digest("hex"),
      bytes: Buffer.byteLength("wal boundary output"),
      stats: {
        relativePath: join("dag", "results", runId, "wal-artifact.stats.json"),
        sha256: createHash("sha256").update(statsRaw).digest("hex"),
        bytes: Buffer.byteLength(statsRaw),
      },
    })
  })

  test("#given a crash after a recovered task transition reaches the WAL #when the engine reopens #then artifact metadata is rebuilt from the durable copy", async () => {
    // given
    const projectDir = tempProject()
    const baseStore = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    const completed = {
      ...taskRecord(owner("artifact"), "completed", "task-artifact"),
      final_response: "recovered artifact output",
      run_stats: { runtime_ms: 31, turns: 3, tool_calls: 2, output_tokens: 11 },
    }
    manager.add(completed)
    baseStore.writeCheckpoint(runId, recoverableRecord(definition([node("artifact")]), {
      artifact: { state: "running", taskId: "task-artifact", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    let runLockDepth = 0
    let resultCopiesUnderLock = 0
    let crashTerminalCheckpoint = true
    const crashingStore: DagFileStore = {
      ...baseStore,
      paths: {
        ...baseStore.paths,
        result(resultRunId, nodeId) {
          if (runLockDepth > 0) resultCopiesUnderLock += 1
          return baseStore.paths.result(resultRunId, nodeId)
        },
      },
      writeCheckpoint(resultRunId, checkpoint) {
        const record = checkpoint as DagRunRecordV1
        if (crashTerminalCheckpoint && record.nodes.some((entry) => entry.state === "completed")) {
          crashTerminalCheckpoint = false
          throw new Error("injected terminal checkpoint crash")
        }
        baseStore.writeCheckpoint(resultRunId, checkpoint)
      },
      withRunLock(resultRunId, operation) {
        return baseStore.withRunLock(resultRunId, () => {
          runLockDepth += 1
          try {
            return operation()
          } finally {
            runLockDepth -= 1
          }
        })
      },
    }
    const firstRecovery = createDagRecovery({
      store: crashingStore,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => false,
    })

    // when
    await expect(firstRecovery.resumePausedRuns(parentSessionId)).rejects.toThrow("injected terminal checkpoint crash")
    const reopenedStore = createDagFileStore({ project_dir: projectDir })
    const [outcome] = await createDagRecovery({
      store: reopenedStore,
      taskManager: manager,
      hostPid: 202,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId)

    // then
    const checkpoint = reopenedStore.readCheckpoint<DagRunRecordV1 & {
      readonly nodes: readonly (DagNode & {
        readonly resultArtifact?: {
          readonly relativePath: string
          readonly sha256: string
          readonly bytes: number
          readonly stats?: { readonly relativePath: string; readonly sha256: string; readonly bytes: number }
        }
      })[]
    }>(runId)
    const artifact = checkpoint?.nodes[0]?.resultArtifact
    const statsRaw = fs.readFileSync(reopenedStore.paths.result(runId, "artifact").replace(/\.txt$/, ".stats.json"), "utf8")
    expect(outcome?.kind).toBe("resumed")
    expect(resultCopiesUnderLock).toBeGreaterThan(0)
    expect(reopenedStore.readResult(runId, "artifact")).toBe("recovered artifact output")
    expect(checkpoint?.nodes[0]?.runStats).toEqual(completed.run_stats)
    expect(artifact).toEqual({
      relativePath: join("dag", "results", runId, "artifact.txt"),
      sha256: createHash("sha256").update("recovered artifact output").digest("hex"),
      bytes: Buffer.byteLength("recovered artifact output"),
      stats: {
        relativePath: join("dag", "results", runId, "artifact.stats.json"),
        sha256: createHash("sha256").update(statsRaw).digest("hex"),
        bytes: Buffer.byteLength(statsRaw),
      },
    })
  })

  test("#given a live run #when shutdown pause starts #then admission stops before pause persistence and its lease is released", () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("active")]), {
      active: { state: "running", taskId: "task-active", attempt: 1 },
    }, { status: "running", leaseHolderPid: 101 }))
    const order: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      stopAdmission: () => order.push("stop"),
      now: () => Date.parse("2026-08-14T00:00:04.000Z"),
    })

    // when
    const paused = recovery.pauseRunsForShutdown(parentSessionId)

    // then
    const checkpoint = store.readCheckpoint<DagRunRecordV1 & { leaseHolderPid?: number; previousLeaseHolderPid?: number }>(runId)
    expect(paused).toEqual([runId])
    expect(order).toEqual(["stop"])
    expect(checkpoint?.status).toBe("paused")
    expect(checkpoint?.leaseHolderPid).toBeUndefined()
    expect(checkpoint?.previousLeaseHolderPid).toBe(101)
    expect(events(store).at(-1)?.type).toBe("dag.run.paused")
  })
})

describe("DAG recovery attempt-scoped ownership", () => {
  test("#given a pre-change checkpoint with legacy owner fingerprints #when resumed #then it completes and the legacy fingerprint is reused verbatim", async () => {
    // given - no amendHistory, no execAttempt, owner fingerprints from the legacy two-field formula
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    const input = definition([node("legacy-done"), node("legacy-next", ["legacy-done"])])
    const legacyRecord = recoverableRecord(input, {
      "legacy-done": { state: "completed", taskId: "task-legacy-done", attempt: 1 },
      "legacy-next": { state: "scheduled" },
    }, { previousLeaseHolderPid: 9001 })
    expect(legacyRecord.amendHistory).toBeUndefined()
    expect(legacyRecord.nodes.every((entry) => entry.execAttempt === undefined)).toBe(true)
    store.writeCheckpoint(runId, legacyRecord)
    store.writeResult(runId, "legacy-done", "legacy output")

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.kind).toBe("resumed")
    expect(outcome?.record?.status).toBe("completed")
    expect(outcome?.reusedOutputs?.get("legacy-done" as DagNodeId)).toBe("legacy output")
    expect(manager.startOwnedCalls).toEqual(["legacy-next"])
    expect(manager.ownerFingerprints).toEqual([
      dagFingerprint({ definitionFingerprint: "definition-fingerprint", nodeId: "legacy-next" }),
    ])
  })

  test("#given a reattach whose observed taskId differs #when resumed #then the display attempt bumps without a new execution and the owner fingerprint still matches", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("drifted")]), {
      drifted: { state: "running", taskId: "task-stale", attempt: 1 },
    }, { previousLeaseHolderPid: 9001 }))
    const persistedOwner: DagTaskOwner = {
      kind: "dag",
      runId,
      nodeId: "drifted" as DagNodeId,
      fingerprint: dagFingerprint({ definitionFingerprint: "definition-fingerprint", nodeId: "drifted" }),
    }
    manager.add(taskRecord(persistedOwner, "completed", "task-owned-drifted"))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    const node0 = outcome?.record?.nodes[0]
    expect(node0).toMatchObject({ state: "completed", taskId: "task-owned-drifted", attempt: 2 })
    expect(node0?.execAttempt).toBeUndefined()
    expect(manager.startOwnedCalls).toEqual([])
    expect(dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: "definition-fingerprint",
      nodeId: "drifted" as DagNodeId,
      ...(node0?.execAttempt === undefined ? {} : { execAttempt: node0.execAttempt }),
    }))).toBe(persistedOwner.fingerprint)
  })

  test("#given a retried pending node with execAttempt #when resumed #then it starts fresh under the attempt-scoped fingerprint", async () => {
    // given
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new RecoveryTaskManager()
    store.writeCheckpoint(runId, recoverableRecord(definition([node("retried")]), {
      retried: { state: "pending", taskId: "task-retried-1", attempt: 1, execAttempt: 2 },
    }, { previousLeaseHolderPid: 9001 }))

    // when
    const [outcome] = await createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
      .resumePausedRuns(parentSessionId)

    // then
    expect(outcome?.record?.nodes[0]?.state).toBe("completed")
    expect(manager.startOwnedCalls).toEqual(["retried"])
    expect(manager.ownerFingerprints).toEqual([
      dagFingerprint(ownerFingerprintInput({
        definitionFingerprint: "definition-fingerprint",
        nodeId: "retried" as DagNodeId,
        execAttempt: 2,
      })),
    ])
  })
})

// #7316: a paused run whose owner session never comes back (fork, compaction, restart under a new
// id) was skipped as foreign_session forever — invisible AND unrecoverable. A run is adoptable only
// when its recorded lease holder is provably gone (dead pid) or is this very process; an absent
// holder proves nothing (a residency-denied pause in a LIVE foreign session has no pid), so it
// must stay untouched.
describe("resumePausedRuns immediate fork-source adoption", () => {
  test("#given a foreign paused run with a dead lease holder #when a fork from that session resumes #then it adopts, re-homes, and completes the run", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("adopt-me")]), {}, {
      parentSessionId: "session-gone",
      rootSessionId: "session-gone",
      previousLeaseHolderPid: 9001,
    }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId, "session-gone")

    // then the run is re-homed to the adopter and resumed instead of orphaned
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["adopted"])
    expect(outcomes[0]?.runId).toBe(runId)
    const rehomed = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(rehomed?.parentSessionId).toBe(parentSessionId)
    expect(rehomed?.rootSessionId).toBe(parentSessionId)
    expect(rehomed?.status).not.toBe("paused")
  })

  test("#given a foreign paused run whose lease holder is alive #when a fork from that session resumes #then the run is left untouched", async () => {
    // given a foreign session that is still running (its pause is mid-resume or residency-held)
    const store = createDagFileStore({ project_dir: tempProject() })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("held")]), {}, {
      parentSessionId: "session-alive",
      rootSessionId: "session-alive",
      previousLeaseHolderPid: 9001,
    }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      isProcessAlive: (pid) => pid === 9001,
    }).resumePausedRuns(parentSessionId, "session-alive")

    // then
    expect(outcomes).toEqual([])
    const untouched = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(untouched?.parentSessionId).toBe("session-alive")
    expect(untouched?.status).toBe("paused")
  })

  test("#given a foreign paused run with no recorded lease holder #when a fork from that session resumes #then abandonment is unproven and the run is left untouched", async () => {
    // given a paused record that never went through the shutdown pause (no pid on record)
    const store = createDagFileStore({ project_dir: tempProject() })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("unproven")]), {}, {
      parentSessionId: "session-unknown",
      rootSessionId: "session-unknown",
    }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      isProcessAlive: () => false,
    }).resumePausedRuns(parentSessionId, "session-unknown")

    // then
    expect(outcomes).toEqual([])
    const untouched = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(untouched?.parentSessionId).toBe("session-unknown")
    expect(untouched?.status).toBe("paused")
  })

  test("#given a foreign paused run whose lease holder is this process #when its fork resumes #then self-adoption is safe and the run completes", async () => {
    // given a run this very process paused under a previous session id (alive, but it is us)
    const store = createDagFileStore({ project_dir: tempProject() })
    store.writeCheckpoint(runId, recoverableRecord(definition([node("self")]), {}, {
      parentSessionId: "session-previous",
      rootSessionId: "session-previous",
      previousLeaseHolderPid: 101,
    }))

    // when
    const outcomes = await createDagRecovery({
      store,
      taskManager: new RecoveryTaskManager(),
      hostPid: 101,
      isProcessAlive: () => true,
    }).resumePausedRuns(parentSessionId, "session-previous")

    // then
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["adopted"])
    const rehomed = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(rehomed?.parentSessionId).toBe(parentSessionId)
  })
})

describe("DAG recovery state directory loss", () => {
  test("#given the runs directory vanished after the store opened #when shutdown pauses and startup resumes runs #then recovery sees no runs instead of an ENOENT crash", async () => {
    // given - a worktree cleanup (git clean, rm -rf .omo) removes the state dir while the session is live
    const store = createDagFileStore({ project_dir: tempProject() })
    fs.rmSync(store.paths.runs, { recursive: true, force: true })
    const recovery = createDagRecovery({ store, taskManager: new RecoveryTaskManager(), hostPid: 101 })

    // when
    const paused = recovery.pauseRunsForShutdown(parentSessionId)
    const outcomes = await recovery.resumePausedRuns(parentSessionId)

    // then
    expect(paused).toEqual([])
    expect(outcomes).toEqual([])
  })
})
