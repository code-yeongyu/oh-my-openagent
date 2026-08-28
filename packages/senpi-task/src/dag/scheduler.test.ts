// allow: SIZE_OK - the scheduler acceptance matrix keeps wave ordering, failure continuation, queue reporting, and residency batching in one fake-manager fixture.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import type { SendInput, SendOutcome } from "../steering"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagWaitSurface } from "./handle"
import type { DagExecutionModeSources } from "./execution-mode"
import { applyDagSchedulerEvent, createDagScheduler, DagNodeControlError, type DagNodeSpawnPolicy } from "./scheduler"
import { createDagJournal } from "./journal"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

// bunfig preloads test-setup.ts to raise the default timeout, but Bun honours a preload's
// setDefaultTimeout only for the FIRST test file of a run; every later file silently reverts to
// the built-in 5000ms. These wave/residency cases drive a fake manager plus a real file store,
// which overshoots 5s on a windows runner and times out the whole barrier suite. Set the floor
// here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const cleanupRoots: string[] = []
const runId = "run-scheduler" as DagRunId
const parentSessionId = "ses-parent"
const rootSessionId = "ses-root"

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function within<T>(promise: Promise<T>, ms = 200): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
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

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-scheduler-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "scheduler-test", name: "scheduler test", nodes }
}

function recordFor(input: DagDefinition): DagRunRecordV1 {
  const createdAt = "2026-08-14T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
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

type StartFailureKind = "plan_unresolved" | "depth_denied" | "start_failed"

type FakeOptions = {
  readonly residencyLimit?: number
  readonly autoComplete?: boolean
  readonly startFailureNodeIds?: readonly string[]
  readonly startFailureKinds?: Readonly<Record<string, StartFailureKind>>
  readonly queuedNodeIds?: readonly string[]
  readonly rejectCancelNodeIds?: readonly string[]
  readonly cancelErrors?: Readonly<Record<string, Error>>
  readonly cancelStarted?: () => void
  readonly cancelGate?: Promise<void>
  readonly rejectStartNodeIds?: readonly string[]
  readonly rejectWaitNodeIds?: readonly string[]
  readonly sendOutcomes?: Readonly<Record<string, SendOutcome>>
  readonly ownerConflictNodeIds?: readonly string[]
}

type MutableTask = {
  record: TaskRecord
  readonly completion: ReturnType<typeof deferred<TaskRecord>>
}

class FakeTaskManager implements TaskManager {
  readonly starts: string[] = []
  readonly startedSpecs: ManagerStartSpec[] = []
  readonly attempts: string[] = []
  readonly residencyDenials: string[] = []
  readonly cancellations: string[] = []
  readonly sends: SendInput[] = []
  readonly owners: DagTaskOwner[] = []
  maxResidents = 0

  readonly #options: FakeOptions
  readonly #tasks = new Map<string, MutableTask>()
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
  #residents = 0
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

  complete(nodeId: string, status: TaskStatus = "completed"): void {
    const task = [...this.#tasks.values()].find((entry) => entry.record.owner?.nodeId === nodeId)
    if (task === undefined) throw new Error(`unknown fake task for ${nodeId}`)
    if (task.record.status === "pending" || task.record.status === "running") this.#residents -= 1
    task.record = {
      ...task.record,
      status,
      updated_at: "2026-08-14T00:00:01.000Z",
      ...(status === "completed"
        ? {
            final_response: `done ${nodeId}`,
            run_stats: { runtime_ms: 25, turns: 2, tool_calls: 1, output_tokens: 8 },
          }
        : { error_message: `${status} ${nodeId}` }),
    }
    task.completion.resolve(task.record)
  }

  async startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = owner.nodeId as string
    this.attempts.push(nodeId)
    this.owners.push(owner)
    if (this.#options.rejectStartNodeIds?.includes(nodeId) === true) throw new Error(`start rejected ${nodeId}`)
    this.startedSpecs.push(spec)
    const existing = [...this.#tasks.values()].find((entry) => entry.record.owner?.nodeId === owner.nodeId)
    if (existing !== undefined) {
      // Mirrors the real manager: an identical fingerprint reuses the persisted task, while a
      // terminal record with a different fingerprint releases its claim so a retry starts fresh.
      const terminal = existing.record.status !== "pending" && existing.record.status !== "running"
      if (existing.record.owner?.fingerprint === owner.fingerprint || !terminal) {
        return {
          kind: "started",
          reused: true,
          task_id: existing.record.task_id,
          status: existing.record.status,
          name: existing.record.name ?? existing.record.task_id,
        }
      }
      this.#tasks.delete(existing.record.task_id)
    }
    const startFailureKind = this.#options.startFailureKinds?.[nodeId] ??
      (this.#options.startFailureNodeIds?.includes(nodeId) === true ? "start_failed" : undefined)
    if (startFailureKind === "plan_unresolved") {
      return { kind: "plan_unresolved", error: { code: "unknown_target", message: `unresolved ${nodeId}` } }
    }
    if (startFailureKind === "depth_denied") {
      return { kind: "depth_denied", reason: `depth denied ${nodeId}`, child_depth: 2, max_depth: 1 }
    }
    if (startFailureKind === "start_failed") {
      return {
        kind: "start_failed",
        task_id: `failed-${nodeId}`,
        name: nodeId,
        category: "quick",
        execution_mode: "in-process",
        model: "fake-model",
        run_in_background: true,
        error_message: `failed to start ${nodeId}`,
      }
    }
    const limit = this.#options.residencyLimit ?? Number.POSITIVE_INFINITY
    if (this.#residents >= limit) {
      this.residencyDenials.push(nodeId)
      return { kind: "residency_denied", reason: "resident child cap reached" }
    }

    this.#taskCounter += 1
    this.#residents += 1
    this.maxResidents = Math.max(this.maxResidents, this.#residents)
    const taskId = `task-${this.#taskCounter}`
    const queued = this.#options.queuedNodeIds?.includes(nodeId) === true
    const completion = deferred<TaskRecord>()
    const task: MutableTask = {
      completion,
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
        status: queued ? "pending" : "running",
        residency_state: "resident",
        created_at: "2026-08-14T00:00:00.000Z",
        updated_at: "2026-08-14T00:00:00.000Z",
        notification: { run_epoch: 1, notified_epoch: 0 },
      },
    }
    this.#tasks.set(taskId, task)
    this.starts.push(nodeId)
    this.#startedSignals.get(nodeId)?.resolve()
    if (this.#options.ownerConflictNodeIds?.includes(nodeId) === true) {
      return {
        kind: "owner_conflict",
        task_id: taskId,
        existing_fingerprint: "live-owner-fingerprint",
        requested_fingerprint: owner.fingerprint,
      }
    }
    if (this.#options.autoComplete !== false) queueMicrotask(() => this.complete(nodeId))
    return {
      kind: "started",
      reused: false,
      task_id: taskId,
      status: queued ? "pending" : "running",
      name: nodeId,
      ...(queued ? { queue_position: 3 } : {}),
    }
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    const nodeId = String(task.record.owner?.nodeId)
    if (this.#options.rejectWaitNodeIds?.includes(nodeId) === true) {
      return Promise.reject(new Error(`wait rejected ${nodeId}`))
    }
    return task.completion.promise
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find((entry) =>
      entry.record.owner?.kind === owner.kind &&
      entry.record.owner.runId === owner.runId &&
      entry.record.owner.nodeId === owner.nodeId,
    )?.record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }

  // Seeds a task record the scheduler can resolve without ever having admitted the node, so send
  // and retry refusals can be exercised against a settled run.
  seed(nodeId: string, status: TaskStatus, taskId = `task-${nodeId}`): TaskRecord {
    const completion = deferred<TaskRecord>()
    const record: TaskRecord = {
      task_id: taskId,
      name: nodeId,
      parent_session_id: parentSessionId,
      root_session_id: rootSessionId,
      depth: 1,
      category: "quick",
      execution_mode: "in-process",
      model: "fake-model",
      notify_on_terminal: true,
      owner: { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: `fingerprint-${nodeId}` },
      status,
      residency_state: "resident",
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
      notification: { run_epoch: 1, notified_epoch: 0 },
    }
    this.#tasks.set(taskId, { record, completion })
    if (status !== "pending" && status !== "running") completion.resolve(record)
    return record
  }

  // Re-arms the settlement of an already-settled fake task, mirroring a revived child whose new
  // run epoch produces a second terminal outcome.
  rearm(taskId: string): void {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    this.#tasks.set(taskId, {
      record: { ...task.record, status: "running" },
      completion: deferred<TaskRecord>(),
    })
  }

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(input: SendInput): Promise<SendOutcome> {
    this.sends.push(input)
    const task = this.#tasks.get(input.idOrName)
    if (task === undefined) {
      return Promise.resolve({ kind: "not_found", reason: `No task found for "${input.idOrName}".`, suggestion: "use task_output" })
    }
    const nodeId = String(task.record.owner?.nodeId)
    const scripted = this.#options.sendOutcomes?.[nodeId]
    if (scripted !== undefined) return Promise.resolve(scripted)
    if (task.record.status === "pending") {
      return Promise.resolve({ kind: "queued", task_id: task.record.task_id, queue_position: 1 })
    }
    if (task.record.status === "running") {
      return Promise.resolve({ kind: "steered", task_id: task.record.task_id, status: "running", delivered: "followUp" })
    }
    if (task.record.status === "completed" || task.record.status === "error" || task.record.status === "interrupted") {
      this.rearm(task.record.task_id)
      return Promise.resolve({ kind: "revived", task_id: task.record.task_id, run_epoch: 2 })
    }
    return Promise.resolve({
      kind: "not_continuable",
      task_id: task.record.task_id,
      reason: `Task ${task.record.task_id} is ${task.record.status} and can no longer be continued.`,
      suggestion: "use task_output",
    })
  }
  interruptTask(): Promise<never> { throw new Error("not implemented") }
  async cancelTask(taskId: string): Promise<{ readonly kind: "cancelled"; readonly task_id: string; readonly previous_status: TaskStatus }> {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    const nodeId = String(task.record.owner?.nodeId)
    this.cancellations.push(nodeId)
    this.#options.cancelStarted?.()
    await this.#options.cancelGate
    if (this.#options.rejectCancelNodeIds?.includes(nodeId) === true) throw new Error(`cancel rejected ${nodeId}`)
    const cancelError = this.#options.cancelErrors?.[nodeId]
    if (cancelError !== undefined) throw cancelError
    const previousStatus = task.record.status
    this.complete(nodeId, "cancelled")
    return { kind: "cancelled", task_id: taskId, previous_status: previousStatus }
  }
  list(): readonly [] { return [] }
  forget(): void {}
  getResidentHandle(): undefined { return undefined }
  subscribeChild(): () => void { return () => undefined }
  residentTaskIds(): readonly string[] { return [] }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
}

function schedulerFixture(
  input: DagDefinition,
  taskManager: FakeTaskManager,
  executionMode?: Omit<DagExecutionModeSources, "route">,
  subscriberRing?: number,
  nodeSpawnPolicy?: DagNodeSpawnPolicy,
) {
  const baseStore = createDagFileStore({ project_dir: tempProject() })
  let runLockDepth = 0
  let resultPathCallsUnderLock = 0
  const store: DagFileStore = {
    ...baseStore,
    paths: {
      ...baseStore.paths,
      result(resultRunId, nodeId) {
        if (runLockDepth > 0) resultPathCallsUnderLock += 1
        return baseStore.paths.result(resultRunId, nodeId)
      },
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
  const initialRecord = recordFor(input)
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-08-14T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager,
    initialRecord,
    ...(executionMode === undefined ? {} : { executionMode }),
    ...(subscriberRing === undefined ? {} : { subscriberRing }),
    ...(nodeSpawnPolicy === undefined ? {} : { nodeSpawnPolicy }),
    now: () => eventTime++,
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 100 }).events
  return { scheduler, events, store, resultPathCallsUnderLock: () => resultPathCallsUnderLock }
}

function waveMembership(events: readonly DagRunEvent[], type: "dag.wave.started" | "dag.wave.completed"): readonly string[][] {
  return events
    .filter((event): event is Extract<DagRunEvent, { type: typeof type }> => event.type === type)
    .map((event) => event.nodeIds.map(String))
}

describe("DAG scheduler owner conflict adoption", () => {
  test("#given a live task owned by another DAG attempt #when its node is admitted #then the scheduler adopts its completion and admits the dependent", async () => {
    // given
    const manager = new FakeTaskManager({ ownerConflictNodeIds: ["A"], autoComplete: false })
    const { scheduler, events } = schedulerFixture(definition([node("A"), node("B", ["A"])]), manager)
    const running = scheduler.run().catch((error: unknown) => {
      throw new Error(`${String(error)} snapshot=${JSON.stringify(scheduler.snapshot())}`)
    })

    // when
    await within(manager.whenStarted("A"))
    manager.complete("A")
    await within(manager.whenStarted("B"))
    manager.complete("B")
    const result = await running

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.find((entry) => entry.id === "A")?.state).toBe("completed")
    expect(result.nodes.find((entry) => entry.id === "B")?.state).toBe("completed")
    expect(events().filter((event) => event.type === "dag.node.task-attached")).toEqual([
      expect.objectContaining({ nodeId: "A", taskId: "task-1" }),
      expect.objectContaining({ nodeId: "B", taskId: "task-2" }),
    ])
  })
})

describe("DAG scheduler terminal result persistence", () => {
  test("#given only the senpi-task scheduler #when a node completes #then output and run stats are persisted without an adapter", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, store, resultPathCallsUnderLock } = schedulerFixture(definition([node("artifact")]), manager)

    // when
    const result = await scheduler.run()

    // then
    expect(result.status).toBe("completed")
    expect(resultPathCallsUnderLock()).toBeGreaterThan(0)
    expect(fs.readFileSync(store.paths.result(runId, "artifact"), "utf8")).toBe("done artifact")
    expect(JSON.parse(fs.readFileSync(store.paths.result(runId, "artifact").replace(/\.txt$/, ".stats.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      runId,
      nodeId: "artifact",
      runStats: { runtime_ms: 25, turns: 2, tool_calls: 1, output_tokens: 8 },
    })
  })
})

describe("DAG scheduler subscriber backpressure", () => {
  test("#given a non-default subscriber ring #when a scheduler listener falls behind #then overflow occurs at the configured bound", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = schedulerFixture(definition([node("ring")]), manager, undefined, 1)
    const releaseFirst = deferred<void>()
    const firstDelivered = deferred<void>()
    const finalDelivered = deferred<void>()
    let firstSeq: number | undefined
    let overflow: Extract<DagRunEvent, { type: "dag.stream.overflow" }> | undefined
    scheduler.subscribe(async (event) => {
      if (event.type === "dag.stream.overflow") overflow = event
      if (event.type === "dag.run.completed") finalDelivered.resolve()
      if (firstSeq === undefined) {
        firstSeq = event.seq
        firstDelivered.resolve()
        await releaseFirst.promise
      }
    })
    const running = scheduler.run()
    await firstDelivered.promise

    // when
    const record = await running
    releaseFirst.resolve()
    await finalDelivered.promise

    // then
    expect(record.status).toBe("completed")
    expect(overflow).toBeDefined()
    expect(overflow?.droppedCount).toBeGreaterThan(0)
    expect(overflow?.recoverAfterSeq).toBe(0)
  })
})

describe("DAG scheduler execution mode dispatch", () => {
  test("#given task.default_execution_mode #when a DAG node is dispatched #then the scheduler resolves through the existing chain", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = schedulerFixture(definition([node("mode")]), manager, {
      agents: {},
      config: { task: { default_execution_mode: "process" } },
    })

    // when
    await scheduler.run()

    // then
    expect(manager.startedSpecs[0]?.execution_mode).toBe("process")
  })
})

describe("DAG scheduler failure semantics", () => {
  test("#given every terminal task status #when folded #then each maps to its exact node outcome and error code", async () => {
    // given
    const cases = [
      { status: "completed", state: "completed", code: undefined },
      { status: "error", state: "failed", code: "task_error" },
      { status: "interrupted", state: "failed", code: "task_interrupted" },
      { status: "lost", state: "failed", code: "task_lost" },
      { status: "cancelled", state: "failed", code: "task_cancelled" },
    ] as const

    for (const outcome of cases) {
      const manager = new FakeTaskManager({ autoComplete: false })
      const { scheduler } = schedulerFixture(definition([node(`task-${outcome.status}`)]), manager)
      const running = scheduler.run()
      await manager.whenStarted(`task-${outcome.status}`)

      // when
      manager.complete(`task-${outcome.status}`, outcome.status)
      const result = await running

      // then
      expect(result.nodes[0]?.state).toBe(outcome.state)
      expect(result.nodes[0]?.error?.code).toBe(outcome.code)
    }
  })

  test("#given every start denial #when admission fails #then each maps to its exact node error code", async () => {
    // given
    const expected = {
      plan: "plan_unresolved",
      depth: "depth_denied",
      start: "start_failed",
      residency: "residency_denied",
    } as const
    const manager = new FakeTaskManager({
      residencyLimit: 0,
      startFailureKinds: { plan: "plan_unresolved", depth: "depth_denied", start: "start_failed" },
    })
    const { scheduler } = schedulerFixture(definition(Object.keys(expected).map((id) => node(id))), manager)

    // when
    const result = await scheduler.run()

    // then
    expect(Object.fromEntries(result.nodes.map((entry) => [entry.id, entry.error?.code]))).toEqual(expected)
  })

  test("#given a failed root with a descendant chain #when failure cascades #then every descendant skip is persisted separately", async () => {
    // given
    const manager = new FakeTaskManager({ startFailureNodeIds: ["root"] })
    const { scheduler, events } = schedulerFixture(
      definition([node("root"), node("child", ["root"]), node("grandchild", ["child"]), node("independent")]),
      manager,
    )

    // when
    const result = await scheduler.run()

    // then
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "root:failed",
      "child:skipped",
      "grandchild:skipped",
      "independent:completed",
    ])
    const skipEvents = events().filter((event): event is Extract<DagRunEvent, { type: "dag.node.transitioned" }> =>
      event.type === "dag.node.transitioned" && event.to === "skipped",
    )
    expect(skipEvents.map((event) => String(event.nodeId))).toEqual(["child", "grandchild"])
    expect(new Set(skipEvents.map((event) => event.seq)).size).toBe(2)
  })

  test("#given graph-ordered failures finish out of order #when independent work settles #then the run uses the first wave and declaration failure", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false })
    const { scheduler, events } = schedulerFixture(
      definition([
        node("later-wave", ["preparation"]),
        node("graph-first"),
        node("completion-first"),
        node("preparation"),
      ]),
      manager,
    )
    const completionFirstSettled = deferred<void>()
    scheduler.subscribe((event) => {
      if (event.type === "dag.node.transitioned" && event.nodeId === "completion-first" && event.to === "failed") {
        completionFirstSettled.resolve()
      }
    })
    const running = scheduler.run()
    await Promise.all([
      manager.whenStarted("graph-first"),
      manager.whenStarted("completion-first"),
      manager.whenStarted("preparation"),
    ])

    // when
    manager.complete("completion-first", "error")
    await completionFirstSettled.promise
    manager.complete("preparation")
    manager.complete("graph-first", "error")
    await manager.whenStarted("later-wave")
    manager.complete("later-wave", "error")
    const result = await running

    // then
    expect(result.status).toBe("failed")
    const completionFirst = result.nodes.find((entry) => entry.id === "completion-first")
    const graphFirst = result.nodes.find((entry) => entry.id === "graph-first")
    expect(Date.parse(completionFirst?.completedAt ?? "")).toBeLessThan(Date.parse(graphFirst?.completedAt ?? ""))
    const failedEvent = events().find((event) => event.type === "dag.run.failed")
    expect(failedEvent).toEqual(expect.objectContaining({ error: expect.objectContaining({ nodeId: "graph-first" }) }))
  })
})

describe("DAG scheduler cancellation", () => {
  test("#given durable waiters armed before and during cancellation #when the scheduler cancels through a separate journal path #then every wait and re-attach settles cancelled", async () => {
    // given
    const cancellationStarted = deferred<void>()
    const releaseCancellation = deferred<void>()
    const manager = new FakeTaskManager({
      autoComplete: false,
      cancelStarted: cancellationStarted.resolve,
      cancelGate: releaseCancellation.promise,
    })
    const { scheduler, store } = schedulerFixture(definition([node("CA"), node("CB", ["CA"])]), manager)
    const waitSurface = createDagWaitSurface({
      store,
      subscribe: () => () => undefined,
      cancel: scheduler.cancel,
    })
    const running = scheduler.run()
    await manager.whenStarted("CA")
    const beforeWait = waitSurface.wait(runId, parentSessionId)
    const beforeAttach = waitSurface.attach(runId, parentSessionId).done()

    // when
    const cancelling = scheduler.cancel(runId, "live cancel")
    await cancellationStarted.promise
    const duringWait = waitSurface.wait(runId, parentSessionId)
    const duringAttach = waitSurface.attach(runId, parentSessionId).done()
    releaseCancellation.resolve()
    await cancelling
    const afterWait = waitSurface.wait(runId, parentSessionId)
    const afterAttach = waitSurface.attach(runId, parentSessionId).done()
    const results = await Promise.all([
      beforeWait,
      beforeAttach,
      duringWait,
      duringAttach,
      afterWait,
      afterAttach,
    ])
    await running

    // then
    expect(manager.starts).toEqual(["CA"])
    expect(results.map((result) => result.status)).toEqual(Array.from({ length: 6 }, () => "cancelled"))
    expect(results.every((result) => result.nodes.CA?.state === "cancelled")).toBe(true)
    expect(results.every((result) => result.nodes.CB?.state === "cancelled")).toBe(true)
    expect(results.every((result) => result.nodes.CA?.state === "cancelled" && result.nodes.CA.reason === "live cancel")).toBe(true)
    expect(waitSurface.waiterCount(runId)).toBe(0)
  })

  test("#given a running wave and pending descendants #when cancelled #then admitted tasks cancel, frontier admission stops, and waiters resolve cancelled", async () => {
    // given - frontier admission: `next` becomes runnable the moment `finished` settles, so it is
    // attached (and cancellable) while wave-0 sibling `running` is still mid-flight.
    const manager = new FakeTaskManager({ autoComplete: false, queuedNodeIds: ["queued"] })
    const { scheduler, events, store } = schedulerFixture(
      definition([node("finished"), node("running"), node("queued"), node("next", ["finished"]), node("last", ["next"])]),
      manager,
    )
    const attached = deferred<void>()
    const finishedSettled = deferred<void>()
    const waitSurface = createDagWaitSurface({
      store,
      subscribe: (_runId, listener) => scheduler.subscribe(listener),
      cancel: scheduler.cancel,
    })
    scheduler.subscribe((event) => {
      if (event.type === "dag.node.task-attached" && event.nodeId === "running") attached.resolve()
      if (event.type === "dag.node.transitioned" && event.nodeId === "finished" && event.to === "completed") {
        finishedSettled.resolve()
      }
    })
    const waiter = waitSurface.wait(runId, parentSessionId)
    const running = scheduler.run()
    await manager.whenStarted("running")
    await attached.promise
    manager.complete("finished")
    await finishedSettled.promise
    await manager.whenStarted("next")

    // when
    await waitSurface.attach(runId, parentSessionId).cancel("stop now")
    const [runResult, waitResult] = await Promise.all([running, waiter])

    // then
    expect(manager.cancellations).toEqual(["running", "queued", "next"])
    expect(manager.starts).toEqual(["finished", "running", "queued", "next"])
    expect(runResult.status).toBe("cancelled")
    expect(runResult.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "finished:completed",
      "running:cancelled",
      "queued:cancelled",
      "next:cancelled",
      "last:cancelled",
    ])
    expect(waitResult.status).toBe("cancelled")
    expect(waitResult.nodes.next?.state).toBe("cancelled")
    expect(waitResult.nodes.last?.state).toBe("cancelled")
    expect(events()).toContainEqual(expect.objectContaining({
      type: "dag.run.cancelled",
      reason: "stop now",
      cancelledNodeIds: ["running", "queued", "next", "last"],
    }))
  })

  test("#given one startOwned rejects after a sibling starts #when cancellation follows #then admission clears and the sibling is attached and cancelled", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false, rejectStartNodeIds: ["reject"] })
    const { scheduler } = schedulerFixture(definition([node("sibling"), node("reject")]), manager)
    const running = scheduler.run()
    await manager.whenStarted("sibling")

    // when
    await within(scheduler.cancel(runId, "stop after rejected admission"))
    const result = await within(running)

    // then
    expect(manager.cancellations).toEqual(["sibling"])
    expect(result.status).toBe("cancelled")
    expect(result.nodes.find((entry) => entry.id === "sibling")?.state).toBe("cancelled")
  })

  test("#given an AbortError returned by task cancellation #when the run is cancelled #then durable cancellation settles and the rejection still surfaces", async () => {
    // given
    const manager = new FakeTaskManager({
      autoComplete: false,
      cancelErrors: { a: new DOMException("intentional abort", "AbortError") },
    })
    const { scheduler, store } = schedulerFixture(definition([node("a"), node("b", ["a"])]), manager)
    const waitSurface = createDagWaitSurface({
      store,
      subscribe: (_runId, listener) => scheduler.subscribe(listener),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")

    // when
    const cancellationFailure = expect(scheduler.cancel(runId, "intentional cancel")).rejects.toThrow("intentional abort")
    const after = await waitSurface.wait(runId, parentSessionId)
    await Promise.all([running, cancellationFailure])

    // then
    expect(after.status).toBe("cancelled")
    expect(after.nodes.a).toEqual(expect.objectContaining({ state: "cancelled" }))
    expect(after.nodes.b).toEqual(expect.objectContaining({ state: "cancelled" }))
  })

  test("#given a genuine task cancellation failure #when a wave is cancelled #then the run settles cancelled and the failure still surfaces", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false, rejectCancelNodeIds: ["a"] })
    const { scheduler, store } = schedulerFixture(definition([node("a"), node("b")]), manager)
    const waitSurface = createDagWaitSurface({
      store,
      subscribe: (_runId, listener) => scheduler.subscribe(listener),
    })
    const firstWaiter = waitSurface.wait(runId, parentSessionId)
    const secondWaiter = waitSurface.wait(runId, parentSessionId)
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("a"), manager.whenStarted("b")])

    // when
    const cancellationFailure = expect(scheduler.cancel(runId, "reject one")).rejects.toThrow("cancel rejected a")
    const [runResult, firstResult, secondResult] = await Promise.all([running, firstWaiter, secondWaiter])

    // then
    await cancellationFailure
    expect(manager.cancellations.sort()).toEqual(["a", "b"])
    expect(runResult.status).toBe("cancelled")
    expect(firstResult).toEqual(secondResult)
    expect(firstResult.snapshot.nodes.every((entry) => entry.state === "cancelled")).toBe(true)
  })

  test("#given a paused unclaimed run #when cancelled #then it ends cancelled without task cancellation", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false })
    const input = definition([node("a"), node("b", ["a"])])
    const store = createDagFileStore({ project_dir: tempProject() })
    const initialRecord: DagRunRecordV1 = { ...recordFor(input), status: "paused" }
    store.writeCheckpoint(runId, initialRecord)
    const scheduler = createDagScheduler({ store, taskManager: manager, initialRecord })

    // when
    await scheduler.cancel(runId, "cancel paused")

    // then
    expect(manager.cancellations).toEqual([])
    expect(scheduler.snapshot().status).toBe("cancelled")
    expect(scheduler.snapshot().nodes.every((entry) => entry.state === "cancelled")).toBe(true)
  })
})

describe("DAG scheduler dependency-frontier admission", () => {
  test("#given a linear three-wave DAG #when run #then nodes and wave events still settle in order", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events } = schedulerFixture(definition([node("a"), node("b", ["a"]), node("c", ["b"])]), manager)

    // when
    const result = await scheduler.run()

    // then
    expect(manager.starts).toEqual(["a", "b", "c"])
    expect(waveMembership(events(), "dag.wave.started")).toEqual([["a"], ["b"], ["c"]])
    expect(waveMembership(events(), "dag.wave.completed")).toEqual([["a"], ["b"], ["c"]])
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["a:completed", "b:completed", "c:completed"])
  })

  test("#given a diamond DAG #when run #then the fan-out shares one admission pass and the join waits for both", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events } = schedulerFixture(
      definition([node("a"), node("b", ["a"]), node("c", ["a"]), node("d", ["b", "c"])]),
      manager,
    )

    // when
    await scheduler.run()

    // then
    expect(waveMembership(events(), "dag.wave.started")).toEqual([["a"], ["b", "c"], ["d"]])
    expect(manager.starts).toEqual(["a", "b", "c", "d"])
  })

  test("#given an unrelated sibling still running #when a dependent's dependencies are all terminal #then the dependent is admitted without waiting for the sibling", async () => {
    // given - the documented dependency contract (and dag_530ad299): b waits on a ONLY. The
    // strict wave barrier used to hold b behind c until c settled, starving ready work.
    const manager = new FakeTaskManager({ autoComplete: false })
    const { scheduler } = schedulerFixture(definition([node("a"), node("c"), node("b", ["a"])]), manager)
    const aStarted = manager.whenStarted("a")
    const cStarted = manager.whenStarted("c")
    const bStarted = manager.whenStarted("b")

    // when
    const running = scheduler.run()
    await Promise.all([aStarted, cStarted])
    manager.complete("a")
    await bStarted

    // then - b runs while c is still mid-flight: frontier admission, no barrier.
    expect(manager.starts).toEqual(["a", "c", "b"])
    manager.complete("b")
    manager.complete("c")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given a dependency still running #when the scheduler is active #then its dependent is not admitted before terminal", async () => {
    // given - the inverse half of the contract: frontier admission never bypasses dependsOn.
    const manager = new FakeTaskManager({ autoComplete: false })
    const { scheduler } = schedulerFixture(definition([node("a"), node("b", ["a"])]), manager)
    const aStarted = manager.whenStarted("a")
    const bStarted = manager.whenStarted("b")

    // when
    const running = scheduler.run()
    await aStarted

    // then
    expect(manager.starts).toEqual(["a"])
    manager.complete("a")
    await bStarted
    expect(manager.starts).toEqual(["a", "b"])
    manager.complete("b")
    await running
  })

  test("#given one waitFor rejects while a sibling is running #when the wave settles #then the rejection becomes one node failure and the sibling completes", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false, rejectWaitNodeIds: ["reject"] })
    const { scheduler } = schedulerFixture(definition([node("reject"), node("sibling")]), manager)
    const rejected = deferred<void>()
    scheduler.subscribe((event) => {
      if (event.type === "dag.node.transitioned" && event.nodeId === "reject" && event.to === "failed") rejected.resolve()
    })
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("reject"), manager.whenStarted("sibling")])

    // when
    await within(rejected.promise)
    manager.complete("sibling")
    const result = await within(running)

    // then
    expect(result.status).toBe("failed")
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "reject:failed",
      "sibling:completed",
    ])
    expect(result.nodes.find((entry) => entry.id === "reject")?.error).toEqual(expect.objectContaining({
      code: "task_error",
      message: "wait rejected reject",
    }))
  })

  test("#given one root start fails #when its wave is admitted #then siblings and the independent branch still run", async () => {
    // given
    const manager = new FakeTaskManager({ startFailureNodeIds: ["b"] })
    const { scheduler, events } = schedulerFixture(
      definition([node("a"), node("b"), node("c", ["a"]), node("d", ["b"])]),
      manager,
    )

    // when
    const result = await scheduler.run()

    // then
    expect(manager.starts).toEqual(["a", "c"])
    expect(manager.attempts.slice(0, 2)).toEqual(["a", "b"])
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "a:completed",
      "b:failed",
      "c:completed",
      "d:skipped",
    ])
    expect(waveMembership(events(), "dag.wave.started")).toEqual([["a", "b"], ["c"]])
  })

  test("#given startOwned queues a scheduled node #when attached #then its queue position is journaled", async () => {
    // given
    const manager = new FakeTaskManager({ queuedNodeIds: ["a"] })
    const { scheduler, events } = schedulerFixture(definition([node("a")]), manager)

    // when
    await scheduler.run()

    // then
    expect(events()).toContainEqual(expect.objectContaining({
      type: "dag.node.transitioned",
      nodeId: "a",
      from: "scheduled",
      to: "scheduled",
      reason: { kind: "task_queued", queuePosition: 3 },
    }))
  })

  test("#given a same-wave node is residency denied #when an attached sibling frees a slot #then admission retries without failing it", async () => {
    // given
    const manager = new FakeTaskManager({ residencyLimit: 1, autoComplete: false })
    const { scheduler, events } = schedulerFixture(definition([node("a"), node("b")]), manager)
    const aStarted = manager.whenStarted("a")
    const bStarted = manager.whenStarted("b")

    // when
    const running = scheduler.run()
    await aStarted
    expect(manager.attempts).toEqual(["a", "b"])
    manager.complete("a")
    await bStarted

    // then
    expect(manager.attempts).toEqual(["a", "b", "b"])
    expect(events().filter((event) => event.type === "dag.node.transitioned" && event.nodeId === "b" && event.to === "failed")).toEqual([])
    manager.complete("b")
    const result = await running
    expect(result.nodes.find((entry) => entry.id === "b")?.state).toBe("completed")
  })

  test("#given a wave wider than residency capacity #when tasks settle #then all nodes are admitted in batches without a second concurrency limit", async () => {
    // given
    const manager = new FakeTaskManager({ residencyLimit: 2 })
    const { scheduler } = schedulerFixture(definition([node("a"), node("b"), node("c"), node("d"), node("e")]), manager)

    // when
    const result = await scheduler.run()

    // then
    expect(manager.starts).toEqual(["a", "b", "c", "d", "e"])
    expect(manager.residencyDenials.length).toBeGreaterThan(0)
    expect(manager.maxResidents).toBe(2)
    expect(result.nodes.every((entry) => entry.state === "completed")).toBe(true)
  })
})

describe("DAG scheduler node spawn policy", () => {
  test("#given a policy that denies an agent-routed node #when the wave admits #then the node fails with the denial message and startOwned is never called", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = schedulerFixture(
      definition([{ id: "review", prompt: "review the plan", subagent_type: "momus" }]),
      manager,
      undefined,
      undefined,
      () => ({ kind: "deny" as const, message: "momus requires a plan gate" }),
    )

    // when
    const result = await scheduler.run()

    // then
    expect(result.nodes[0]?.state).toBe("failed")
    expect(result.nodes[0]?.error?.message).toContain("momus requires a plan gate")
    expect(manager.attempts).toEqual([])
  })

  test("#given a policy that forces the prompt #when the node starts #then the child receives the forced prompt", async () => {
    // given
    const manager = new FakeTaskManager()
    const canonical = "Review the work plan at .omo/plans/x.md for contradictions and blocking issues."
    const { scheduler } = schedulerFixture(
      definition([{ id: "review", prompt: "caller wording", subagent_type: "momus" }]),
      manager,
      undefined,
      undefined,
      () => ({ kind: "force" as const, prompt: canonical }),
    )

    // when
    await scheduler.run()

    // then
    expect(manager.startedSpecs[0]?.prompt).toBe(canonical)
  })

  test("#given category-routed nodes #when the wave admits #then the policy is never consulted", async () => {
    // given
    const manager = new FakeTaskManager()
    let calls = 0
    const { scheduler } = schedulerFixture(definition([node("plain")]), manager, undefined, undefined, () => {
      calls += 1
      return { kind: "allow" as const }
    })

    // when
    await scheduler.run()

    // then
    expect(calls).toBe(0)
  })
})

type NodeOverrides = Readonly<Record<string, Partial<DagNode>>>

// A settled run rebuilt from the durable checkpoint: exactly what a retry/send caller reaches after
// the original scheduler instance has already resolved its run promise.
function settledFixture(
  input: DagDefinition,
  manager: FakeTaskManager,
  states: NodeOverrides,
  overrides: Partial<DagRunRecordV1> = {},
  // Lease-ownership seams: injected so a lease test cannot pass by coincidence with the real pid.
  lease: { readonly hostPid?: number; readonly isProcessAlive?: (pid: number) => boolean } = {},
) {
  const store = createDagFileStore({ project_dir: tempProject() })
  const base = recordFor(input)
  const initialRecord: DagRunRecordV1 = {
    ...base,
    status: "failed",
    startedAt: "2026-08-14T00:00:01.000Z",
    completedAt: "2026-08-14T00:00:09.000Z",
    nodes: base.nodes.map((entry) => ({ ...entry, ...states[String(entry.id)] })),
    ...overrides,
  }
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-08-14T00:00:10.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
    ...(lease.hostPid === undefined ? {} : { hostPid: lease.hostPid }),
    ...(lease.isProcessAlive === undefined ? {} : { isProcessAlive: lease.isProcessAlive }),
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 200 }).events
  // The durable checkpoint, not the settled instance's in-memory snapshot: control verbs journal
  // through a fresh journal, and every downstream reader (wait, snapshot, TUI) reads the record.
  const durable = (): DagRunRecordV1 => {
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) throw new Error("missing durable checkpoint")
    return record
  }
  return { scheduler, store, events, durable, initialRecord, runId }
}

describe("DAG scheduler node controls", () => {
  test("#given a completed node #when retry is requested #then it refuses with node_not_retryable", () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = settledFixture(definition([node("done"), node("broken")]), manager, {
      done: { state: "completed", taskId: "task-done", attempt: 1 },
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
    })

    // when
    const refusal = () => scheduler.retryNode(runId, ["done" as DagNodeId])

    // then
    expect(refusal).toThrow(DagNodeControlError)
    expect(refusal).toThrow(/node_not_retryable|amend/)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("node_not_retryable")
      expect((error as DagNodeControlError).nodeIds.map(String)).toEqual(["done"])
    }
    expect(scheduler.snapshot().nodes.find((entry) => entry.id === "done")?.state).toBe("completed")
  })

  test("#given a cancelled node child #when send is requested #then it refuses with node_not_continuable and names retry", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = settledFixture(definition([node("cancelled")]), manager, {
      cancelled: { state: "cancelled", taskId: "task-cancelled", attempt: 1 },
    }, { status: "cancelled" })
    manager.seed("cancelled", "cancelled")

    // when
    const sent = scheduler.sendToNode(runId, "cancelled" as DagNodeId, "try again")

    // then
    await expect(sent).rejects.toBeInstanceOf(DagNodeControlError)
    await expect(sent).rejects.toMatchObject({ code: "node_not_continuable" })
    await expect(sent).rejects.toThrow(/Retry the node/)
  })

  test("#given a failed node with skipped dependents #when retried #then execAttempt increments, dependents unblock, and the run re-enters to completion", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events, durable } = settledFixture(
      definition([node("root"), node("broken"), node("dependent", ["broken"])]),
      manager,
      {
        root: { state: "completed", taskId: "task-root", attempt: 1 },
        broken: {
          state: "failed",
          taskId: "task-broken",
          attempt: 1,
          error: { code: "task_error", message: "boom", nodeId: "broken" as DagNodeId, at: "2026-08-14T00:00:05.000Z" },
        },
        dependent: { state: "skipped" },
      },
    )

    // when
    const retried = scheduler.retryNode(runId)
    const resumedSynchronously = durable()
    const record = await retried.run

    // then
    expect(resumedSynchronously.status).toBe("running")
    expect(resumedSynchronously.completedAt).toBeUndefined()
    const retriedNode = retried.record.nodes.find((entry) => entry.id === "broken")
    expect(retriedNode).toMatchObject({ state: "pending", execAttempt: 1, attempt: 1 })
    expect(retriedNode?.error).toBeUndefined()
    // Default selection retries the skipped dependents too, so they come back as pending work.
    expect(retried.record.nodes.find((entry) => entry.id === "dependent")?.state).toBe("pending")
    expect(record.status).toBe("completed")
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "root:completed",
      "broken:completed",
      "dependent:completed",
    ])
    expect(manager.starts).toEqual(["broken", "dependent"])
    expect(record.nodes.find((entry) => entry.id === "root")?.taskId).toBe("task-root")
    const retryEvent = events().find((event) => event.type === "dag.node.retried")
    expect(retryEvent).toMatchObject({ type: "dag.node.retried", nodeId: "broken", execAttempt: 1, promptChanged: false, priorTaskId: "task-broken" })
    const types = events().map((event) => event.type)
    expect(types.indexOf("dag.run.resumed")).toBeGreaterThan(types.indexOf("dag.node.retried"))
  })

  test("#given a retried node #when it is admitted again #then the owner fingerprint folds the new execAttempt", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = settledFixture(definition([node("broken")]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
    })

    // when
    await scheduler.retryNode(runId).run

    // then
    expect(manager.owners.map((entry) => entry.fingerprint)).toHaveLength(1)
    expect(manager.owners[0]?.fingerprint).not.toBe(
      dagFingerprint({ definitionFingerprint: "definition-fingerprint", nodeId: "broken" }),
    )
    expect(manager.owners[0]?.fingerprint).toBe(dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: "definition-fingerprint",
      nodeId: "broken" as DagNodeId,
      execAttempt: 1,
    })))
  })

  test("#given an explicit retry of only the failed ancestor #when re-entered #then its skipped dependents are restored to blocked", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events } = settledFixture(
      definition([node("broken"), node("dependent", ["broken"]), node("grandchild", ["dependent"])]),
      manager,
      {
        broken: { state: "failed", taskId: "task-broken", attempt: 1 },
        dependent: { state: "skipped" },
        grandchild: { state: "skipped" },
      },
    )

    // when
    const retried = scheduler.retryNode(runId, ["broken" as DagNodeId])

    // then
    expect(retried.record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "broken:pending",
      "dependent:blocked",
      "grandchild:blocked",
    ])
    expect(retried.record.nodes.filter((entry) => entry.execAttempt !== undefined).map((entry) => String(entry.id)))
      .toEqual(["broken"])
    expect(events().filter((event) => event.type === "dag.node.transitioned" && event.to === "blocked").map((event) =>
      event.type === "dag.node.transitioned" ? String(event.nodeId) : "",
    )).toEqual(["dependent", "grandchild"])
    expect((await retried.run).status).toBe("completed")
  })

  test("#given a skipped node whose failed ancestor stays failed #when retried alone #then it refuses and names the ancestor", () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = settledFixture(
      definition([node("broken"), node("dependent", ["broken"])]),
      manager,
      {
        broken: { state: "failed", taskId: "task-broken", attempt: 1 },
        dependent: { state: "skipped" },
      },
    )

    // when
    const refusal = () => scheduler.retryNode(runId, ["dependent" as DagNodeId])

    // then
    expect(refusal).toThrow(DagNodeControlError)
    expect(refusal).toThrow(/broken/)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("node_not_retryable")
    }
  })

  test("#given a running run #when retry is requested #then it refuses with run_still_active and journals nothing", () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events } = settledFixture(definition([node("broken"), node("busy")]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
      busy: { state: "running", taskId: "task-busy", attempt: 1 },
    }, { status: "running", completedAt: undefined })

    // when
    const refusal = () => scheduler.retryNode(runId, ["broken" as DagNodeId])

    // then
    expect(refusal).toThrow(DagNodeControlError)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("run_still_active")
    }
    expect(events()).toEqual([])
  })

  test("#given a foreign pid holds the lease and is alive #when retry is requested for THIS run #then it refuses with run_not_owned naming that pid", () => {
    // given — the pid must differ from hostPid and be reported ALIVE, otherwise the guard is a no-op.
    // Both are injected so the assertion cannot pass by coincidence with the running process.
    const manager = new FakeTaskManager()
    const foreignPid = 424242
    const probed: number[] = []
    const { scheduler, runId } = settledFixture(definition([node("broken")]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
    }, { leaseHolderPid: foreignPid } as Partial<DagRunRecordV1>, {
      hostPid: foreignPid + 1,
      isProcessAlive: (pid: number) => {
        probed.push(pid)
        return true
      },
    })

    // when — the REAL run id, so execution reaches the lease block instead of the run-mismatch branch.
    const refusal = () => scheduler.retryNode(runId, ["broken" as DagNodeId])

    // then
    expect(refusal).toThrow(DagNodeControlError)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("run_not_owned")
      expect((error as DagNodeControlError).message).toContain(String(foreignPid))
    }
    expect(probed).toContain(foreignPid)
  })

  test("#given the lease pid is dead #when retry is requested #then the guard lets it through and the node re-runs", () => {
    // given — same foreign pid, but reported DEAD: the guard must NOT refuse, proving it gates on
    // liveness rather than on the pid field being present at all.
    const manager = new FakeTaskManager()
    const foreignPid = 424242
    const { scheduler, runId, events } = settledFixture(definition([node("broken")]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
    }, { leaseHolderPid: foreignPid } as Partial<DagRunRecordV1>, {
      hostPid: foreignPid + 1,
      isProcessAlive: () => false,
    })

    // when
    scheduler.retryNode(runId, ["broken" as DagNodeId])

    // then
    expect(events().some((event) => event.type === "dag.node.retried")).toBe(true)
  })

  test("#given a running node #when send delivers a steer #then the node stays running and the journal records delivery steer", async () => {
    // given
    const manager = new FakeTaskManager({ autoComplete: false })
    const { scheduler, events, store } = schedulerFixture(definition([node("chatty")]), manager)
    const attached = deferred<void>()
    scheduler.subscribe((event) => {
      if (event.type === "dag.node.task-attached") attached.resolve()
    })
    const running = scheduler.run()
    await manager.whenStarted("chatty")
    await attached.promise

    // when
    const sent = await scheduler.sendToNode(runId, "chatty" as DagNodeId, "focus on the tests")

    // then
    expect({ ...sent, nodeId: String(sent.nodeId) }).toEqual({ delivery: "steer", nodeId: "chatty", taskId: "task-1" })
    expect(manager.sends.map((entry) => entry.message)).toEqual(["focus on the tests"])
    expect(scheduler.snapshot().nodes[0]?.state).toBe("running")
    expect(store.readCheckpoint<DagRunRecordV1>(runId)?.nodes[0]?.state).toBe("running")
    expect(events()).toContainEqual(expect.objectContaining({
      type: "dag.node.steered",
      nodeId: "chatty",
      taskId: "task-1",
      delivery: "steer",
    }))
    manager.complete("chatty")
    await running
  })

  test("#given a failed node whose child is still resident #when send revives it #then the node runs again and its new outcome settles exactly once", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events, store, durable } = settledFixture(definition([node("revivable")]), manager, {
      revivable: {
        state: "failed",
        taskId: "task-revivable",
        attempt: 1,
        error: { code: "task_error", message: "boom", nodeId: "revivable" as DagNodeId, at: "2026-08-14T00:00:05.000Z" },
      },
    })
    manager.seed("revivable", "error", "task-revivable")

    // when
    const sent = await scheduler.sendToNode(runId, "revivable" as DagNodeId, "try the other approach")
    const running = durable()
    manager.complete("revivable")
    await sent.settled

    // then
    expect(sent.delivery).toBe("revive")
    expect(running.nodes[0]?.state).toBe("running")
    expect(durable().nodes[0]).toMatchObject({ state: "completed" })
    expect(durable().nodes[0]?.error).toBeUndefined()
    expect(events()).toContainEqual(expect.objectContaining({ type: "dag.node.steered", delivery: "revive" }))
    expect(events().filter((event) => event.type === "dag.node.transitioned" && event.to === "completed")).toHaveLength(1)
    expect(fs.readFileSync(store.paths.result(runId, "revivable"), "utf8")).toBe("done revivable")
  })

  test("#given the full send outcome vocabulary #when a node child is messaged #then each outcome maps to its exact result or refusal", async () => {
    // given
    const manager = new FakeTaskManager({
      sendOutcomes: {
        "one-shot": { kind: "one_shot_agent", task_id: "task-one-shot", agent: "momus", message: "momus takes no follow-ups" },
        denied: { kind: "scope_denied", task_id: "task-denied", owning_session_id: "other", reason: "belongs to another session" },
        detached: { kind: "not_continuable", task_id: "task-detached", reason: "suspended", suggestion: "task_output" },
      },
    })
    const { scheduler } = settledFixture(
      definition([node("queued"), node("one-shot"), node("denied"), node("detached"), node("never-ran"), node("ghost")]),
      manager,
      {
        queued: { state: "running", taskId: "task-queued", attempt: 1 },
        "one-shot": { state: "failed", taskId: "task-one-shot", attempt: 1 },
        denied: { state: "failed", taskId: "task-denied", attempt: 1 },
        detached: { state: "failed", taskId: "task-detached", attempt: 1 },
        "never-ran": { state: "skipped" },
        ghost: { state: "failed", taskId: "task-ghost", attempt: 1 },
      },
    )
    manager.seed("queued", "pending", "task-queued")
    manager.seed("one-shot", "completed", "task-one-shot")
    manager.seed("denied", "completed", "task-denied")
    manager.seed("detached", "completed", "task-detached")

    // when
    const queued = await scheduler.sendToNode(runId, "queued" as DagNodeId, "queued message")
    const outcomes: Record<string, string> = {}
    for (const nodeId of ["one-shot", "denied", "detached", "never-ran", "ghost", "absent"]) {
      try {
        await scheduler.sendToNode(runId, nodeId as DagNodeId, "message")
        outcomes[nodeId] = "delivered"
      } catch (error) {
        outcomes[nodeId] = `${(error as DagNodeControlError).code}:${(error as DagNodeControlError).message}`
      }
    }

    // then
    expect({ ...queued, nodeId: String(queued.nodeId) }).toEqual({
      delivery: "queued",
      nodeId: "queued",
      taskId: "task-queued",
      queuePosition: 1,
    })
    expect(outcomes["one-shot"]).toContain("node_not_continuable")
    expect(outcomes["one-shot"]).toContain("momus takes no follow-ups")
    expect(outcomes.denied).toContain("node_not_continuable")
    expect(outcomes.denied).toContain("belongs to another session")
    expect(outcomes.detached).toContain("node_not_continuable")
    expect(outcomes.detached).toContain("Retry the node")
    expect(outcomes["never-ran"]).toContain("node_has_no_task")
    expect(outcomes.ghost).toContain("node_not_found")
    expect(outcomes.absent).toContain("node_not_found")
  })

  test("#given a single explicit node and a prompt override #when retried #then the amendment is journaled before the retry and the new prompt runs", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, events } = settledFixture(definition([node("broken"), node("dependent", ["broken"])]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
      dependent: { state: "skipped" },
    })

    // when
    const retried = scheduler.retryNode(runId, ["broken" as DagNodeId], { prompt: "do broken differently" })
    await retried.run

    // then
    const types = events().map((event) => event.type)
    expect(types.indexOf("dag.definition.amended")).toBeGreaterThanOrEqual(0)
    expect(types.indexOf("dag.definition.amended")).toBeLessThan(types.indexOf("dag.node.retried"))
    expect(events().find((event) => event.type === "dag.node.retried")).toMatchObject({ promptChanged: true })
    expect(manager.startedSpecs.map((spec) => spec.prompt)).toEqual(["do broken differently", "do dependent"])
  })

  test("#given a prompt override the definition compiler rejects #when retried #then the refusal is total: invalid_arguments, nothing journaled, no task started", () => {
    // given — a REAL rejection reachable from amendRetryPrompt: compileDag enforces max_prompt_bytes
    // (default 262144), and amendRetryPrompt compiles against the defaults, so an oversized prompt
    // makes manager.amend reject and leaves the definition fingerprint untouched. That unchanged
    // fingerprint is the only signal the synchronous verb has, and the guard under test is what turns
    // it into a caller-visible refusal instead of a silent retry on the unamended definition.
    const manager = new FakeTaskManager()
    const { scheduler, events, runId: id } = settledFixture(definition([node("broken")]), manager, {
      broken: { state: "failed", taskId: "task-broken", attempt: 1 },
    })
    const oversized = "x".repeat(262145)

    // when
    const refusal = () => scheduler.retryNode(id, ["broken" as DagNodeId], { prompt: oversized })

    // then
    expect(refusal).toThrow(DagNodeControlError)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("invalid_arguments")
      expect((error as DagNodeControlError).message).toContain("prompt override was rejected")
    }
    // Total refusal: the node stays failed rather than half-retried against the old prompt.
    expect(events().some((event) => event.type === "dag.node.retried")).toBe(false)
    expect(manager.startedSpecs).toEqual([])
  })

  test("#given a prompt override with more than one target #when retried #then it refuses with invalid_arguments", () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler } = settledFixture(definition([node("a"), node("b")]), manager, {
      a: { state: "failed", taskId: "task-a", attempt: 1 },
      b: { state: "failed", taskId: "task-b", attempt: 1 },
    })

    // when
    const refusal = () => scheduler.retryNode(runId, ["a" as DagNodeId, "b" as DagNodeId], { prompt: "changed" })

    // then
    expect(refusal).toThrow(DagNodeControlError)
    try {
      refusal()
    } catch (error) {
      expect((error as DagNodeControlError).code).toBe("invalid_arguments")
    }
  })
})

describe("applyDagSchedulerEvent resume reducer", () => {
  test("#given a settled run record #when a resume is applied #then status runs again and the stale completedAt is cleared", () => {
    // given
    const base = recordFor(definition([node("only")]))
    const settled: DagRunRecordV1 = {
      ...base,
      status: "failed",
      completedAt: "2026-08-14T00:00:09.000Z",
      nodes: base.nodes.map((entry) => ({ ...entry, state: "failed" as const })),
    }

    // when
    const resumed = applyDagSchedulerEvent(settled, {
      schemaVersion: 1,
      runId,
      seq: 12,
      at: "2026-08-14T00:00:11.000Z",
      lane: "boundary",
      type: "dag.run.resumed",
      generation: 2,
    })

    // then
    expect(resumed.status).toBe("running")
    expect(resumed.generation).toBe(2)
    expect(resumed.completedAt).toBeUndefined()
    expect(resumed.updatedAt).toBe("2026-08-14T00:00:11.000Z")
  })

  test("#given a retried event #when applied through the scheduler reducer #then the shared record mutation runs", () => {
    // given
    const base = recordFor(definition([node("only")]))
    const failed: DagRunRecordV1 = {
      ...base,
      status: "failed",
      nodes: base.nodes.map((entry) => ({
        ...entry,
        state: "failed" as const,
        taskId: "task-only",
        attempt: 1,
        error: { code: "task_error" as const, message: "boom", nodeId: entry.id, at: "2026-08-14T00:00:05.000Z" },
      })),
    }

    // when
    const retried = applyDagSchedulerEvent(failed, {
      schemaVersion: 1,
      runId,
      seq: 13,
      at: "2026-08-14T00:00:11.000Z",
      lane: "boundary",
      type: "dag.node.retried",
      nodeId: "only" as DagNodeId,
      execAttempt: 1,
      promptChanged: false,
    })

    // then
    expect(retried.nodes[0]).toMatchObject({ state: "pending", execAttempt: 1, attempt: 1 })
    expect(retried.nodes[0]?.error).toBeUndefined()
  })
})

describe("DAG scheduler control-event replay", () => {
  test("#given a retried and revived run #when the checkpoint is rebuilt from the WAL alone #then it matches the live record", async () => {
    // given
    const manager = new FakeTaskManager()
    const { scheduler, store, durable, initialRecord } = settledFixture(
      definition([node("root"), node("broken"), node("dependent", ["broken"])]),
      manager,
      {
        root: { state: "completed", taskId: "task-root", attempt: 1 },
        broken: { state: "failed", taskId: "task-broken", attempt: 1 },
        dependent: { state: "skipped" },
      },
    )
    await scheduler.retryNode(runId, ["broken" as DagNodeId]).run
    const live = durable()

    // when - drop the checkpoint, forcing every control event to replay through the reducer from the
    // pre-retry record (the state the crashed process would reopen with)
    fs.unlinkSync(store.paths.run(runId))
    const replayed = createDagJournal<DagRunRecordV1>({
      store,
      runId,
      initialCheckpoint: initialRecord,
      applyEvent: (checkpoint, event) => applyDagSchedulerEvent(checkpoint, event),
    })

    // then
    expect(live.status).toBe("completed")
    expect(replayed.snapshot().status).toBe("completed")
    expect(replayed.snapshot().nodes.map((entry) => `${entry.id}:${entry.state}:${entry.execAttempt ?? 0}`)).toEqual(
      live.nodes.map((entry) => `${entry.id}:${entry.state}:${entry.execAttempt ?? 0}`),
    )
    expect(replayed.snapshot().completedAt).toBe(live.completedAt)
  })
})
