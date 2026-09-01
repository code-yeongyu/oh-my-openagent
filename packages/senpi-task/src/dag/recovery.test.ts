// allow: SIZE_OK - restart recovery needs one acceptance fixture spanning leases, task ownership, artifacts, and wave continuation.
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

const cleanupRoots: string[] = []
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
    if (existing !== undefined) {
      return { kind: "started", reused: true, task_id: existing.task_id, status: existing.status, name: existing.name ?? existing.task_id }
    }
    const record = taskRecord(owner, "running")
    this.add(record)
    if (this.#autoCompleteStarts) queueMicrotask(() => this.complete(record.task_id))
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

function owner(nodeId: string): DagTaskOwner {
  return { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: "unused-by-fake" }
}

function events(store: DagFileStore): readonly DagRunEvent[] {
  return store.readEvents(runId, 0, { limit: 100 }).events
}

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

    // then
    expect(outcomes).toEqual([{ runId, kind: "skipped", reason: "live_lease" }])
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

  test("#given a paused run owned by a dead foreign session #when recovery adopts it #then the resume is journaled on the run's own ledger", async () => {
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
    }).resumePausedRuns(parentSessionId)

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
    expect(outcomesB).toEqual([{ runId, kind: "skipped", reason: "live_lease" }])
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
describe("resumePausedRuns adoption", () => {
  test("#given a foreign paused run with a dead lease holder #when a new session resumes #then it adopts, re-homes, and completes the run", async () => {
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
    }).resumePausedRuns(parentSessionId)

    // then the run is re-homed to the adopter and resumed instead of orphaned
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["adopted"])
    expect(outcomes[0]?.runId).toBe(runId)
    const rehomed = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(rehomed?.parentSessionId).toBe(parentSessionId)
    expect(rehomed?.rootSessionId).toBe(parentSessionId)
    expect(rehomed?.status).not.toBe("paused")
  })

  test("#given a foreign paused run whose lease holder is alive #when another session resumes #then the run is left untouched", async () => {
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
    }).resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toEqual([])
    const untouched = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(untouched?.parentSessionId).toBe("session-alive")
    expect(untouched?.status).toBe("paused")
  })

  test("#given a foreign paused run with no recorded lease holder #when another session resumes #then abandonment is unproven and the run is left untouched", async () => {
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
    }).resumePausedRuns(parentSessionId)

    // then
    expect(outcomes).toEqual([])
    const untouched = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(untouched?.parentSessionId).toBe("session-unknown")
    expect(untouched?.status).toBe("paused")
  })

  test("#given a foreign paused run whose lease holder is this process #when it resumes #then self-adoption is safe and the run completes", async () => {
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
    }).resumePausedRuns(parentSessionId)

    // then
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["adopted"])
    const rehomed = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(rehomed?.parentSessionId).toBe(parentSessionId)
  })
})
