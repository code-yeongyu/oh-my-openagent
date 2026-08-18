// allow: SIZE_OK - the scheduler acceptance matrix keeps wave ordering, failure continuation, queue reporting, and residency batching in one fake-manager fixture.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagWaitSurface } from "./handle"
import type { DagExecutionModeSources } from "./execution-mode"
import { createDagScheduler, type DagNodeSpawnPolicy } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunEvent, DagRunId } from "./types"

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
    if (this.#options.rejectStartNodeIds?.includes(nodeId) === true) throw new Error(`start rejected ${nodeId}`)
    this.startedSpecs.push(spec)
    const existing = [...this.#tasks.values()].find((entry) => entry.record.owner?.nodeId === owner.nodeId)
    if (existing !== undefined) {
      return {
        kind: "started",
        reused: true,
        task_id: existing.record.task_id,
        status: existing.record.status,
        name: existing.record.name ?? existing.record.task_id,
      }
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

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(): Promise<never> { throw new Error("not implemented") }
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

  test("#given a running wave and pending descendants #when cancelled #then tasks cancel, admission stops, and waiters resolve cancelled", async () => {
    // given
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

    // when
    await waitSurface.attach(runId, parentSessionId).cancel("stop now")
    const [runResult, waitResult] = await Promise.all([running, waiter])

    // then
    expect(manager.cancellations).toEqual(["running", "queued"])
    expect(manager.starts).toEqual(["finished", "running", "queued"])
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

describe("DAG scheduler strict wave barrier", () => {
  test("#given a linear three-wave DAG #when run #then nodes and wave events are admitted in order", async () => {
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

  test("#given a diamond DAG #when run #then the fan-out shares one wave and the join waits for it", async () => {
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

  test("#given a wave-one task is still running #when the scheduler is active #then wave two is not admitted before terminal", async () => {
    // given
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
