// Regression for the dag_530ad299 starvation class: admission is dependency-frontier, so a node
// whose dependsOn are all completed must start while an UNRELATED sibling that shares its wave
// keeps running. Adapted (event-driven, no wall-clock waits) from the failing-first repro at
// .omo/evidence/20260825-dag-dep-frontier/baseline-repro/dag-stall-repro.test.ts (R2), which
// timed out RED on origin/dev: the strict wave barrier held lane-b behind lane-c for as long as
// lane-c ran (production: hours).
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagNodeTransitionedEvent } from "./events"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import { controlJournal } from "./node-control-context"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { persistDagNodeResult } from "./results"
import { createDagScheduler, type DagSchedulerOptions } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunEvent, DagRunId } from "./types"

// See scheduler.test.ts: Bun honours a preload's setDefaultTimeout only for the first test file
// of a run; every later file silently reverts to 5000ms, which undershoots these file-store cases
// on a windows runner.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const runId = "run-frontier" as DagRunId
const parentSessionId = "ses-frontier-parent"
const rootSessionId = "ses-frontier-root"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-frontier-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "frontier-test", name: "frontier test", nodes }
}

function recordFor(input: DagDefinition): DagRunRecordV1 {
  const createdAt = "2026-08-25T00:00:00.000Z"
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

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type FakeOptions = {
  readonly residencyLimit?: number
}

class FrontierFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly attempts: string[] = []
  readonly denials: string[] = []
  readonly #options: FakeOptions
  readonly #tasks = new Map<string, {
    record: TaskRecord
    readonly completion: Promise<TaskRecord>
    readonly resolveCompletion: (record: TaskRecord) => void
  }>()
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
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
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId)
    this.attempts.push(nodeId)
    const existing = this.recordOf(nodeId)
    if (existing !== undefined) {
      return { kind: "started", reused: true, task_id: existing.task_id, status: existing.status, name: existing.name ?? existing.task_id }
    }
    const limit = this.#options.residencyLimit ?? Number.POSITIVE_INFINITY
    const residents = [...this.#tasks.values()]
      .filter((entry) => entry.record.status === "pending" || entry.record.status === "running")
      .length
    if (residents >= limit) {
      this.denials.push(nodeId)
      return { kind: "residency_denied", reason: "resident child cap reached" }
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

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId)
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`)
    return entry.completion
  }

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(): Promise<never> { throw new Error("not implemented") }
  interruptTask(): Promise<never> { throw new Error("not implemented") }
  cancelTask(): Promise<never> { throw new Error("not implemented") }
  list(): readonly [] { return [] }
  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }
  forget(): void {}
  getResidentHandle(): undefined { return undefined }
  subscribeChild(): () => void { return () => undefined }
  residentTaskIds(): readonly string[] { return [] }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
}

function frontierFixture(input: DagDefinition, manager: FrontierFakeManager) {
  const store = createDagFileStore({ project_dir: tempProject() })
  const initialRecord = recordFor(input)
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-08-25T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
  })
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 200 }).events
  return { scheduler, events, store }
}

// Event-driven settle observation: resolves once the node reaches the state, never by sleeping.
function whenNodeState(
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

describe("DAG scheduler dependency-frontier admission", () => {
  test("#given a dependent whose dependsOn completed #when an unrelated sibling keeps running #then the dependent is admitted at once (dag_530ad299)", async () => {
    // given - the incident shape: lane-a and lane-c share wave 0; lane-b depends ONLY on lane-a.
    const manager = new FrontierFakeManager()
    const { scheduler, events } = frontierFixture(
      definition([node("lane-a"), node("lane-c"), node("lane-b", ["lane-a"])]),
      manager,
    )

    // when - lane-a settles while lane-c keeps running (production: 2h+).
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("lane-a"), manager.whenStarted("lane-c")])
    manager.complete("lane-a")
    await manager.whenStarted("lane-b")

    // then - lane-b started while lane-c is still running: dependency semantics, no wave barrier.
    expect(manager.starts).toEqual(["lane-a", "lane-c", "lane-b"])
    expect(manager.recordOf("lane-c")?.status).toBe("running")

    // and - wave events stay informational: wave 1 admitted lane-b even though wave 0 is open.
    const startedWaveOne = events().find((event) =>
      event.type === "dag.wave.started" && event.waveIndex === 1)
    expect(startedWaveOne).toMatchObject({ nodeIds: ["lane-b"] })

    // cleanup - the run settles only once every node is terminal.
    manager.complete("lane-b")
    manager.complete("lane-c")
    const result = await running
    expect(result.status).toBe("completed")
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "lane-a:completed",
      "lane-c:completed",
      "lane-b:completed",
    ])

    // and - the wave 1 grouping was reported BEFORE wave 0 finished grouping: interleaving is
    // expected under frontier admission, and both indexes still complete exactly once.
    const completedWaveZero = events().find((event) =>
      event.type === "dag.wave.completed" && event.waveIndex === 0)
    expect(startedWaveOne?.seq).toBeLessThan(completedWaveZero?.seq ?? Number.POSITIVE_INFINITY)
  })

  test("#given a dependency still running #when the scheduler is active #then its dependent is not admitted before terminal", async () => {
    // given - the other half of the contract: frontier admission never bypasses dependsOn.
    const manager = new FrontierFakeManager()
    const { scheduler } = frontierFixture(definition([node("a"), node("b", ["a"]), node("c", ["a", "b"])]), manager)

    // when
    const running = scheduler.run()
    await manager.whenStarted("a")

    // then - b and c hold while a runs, even though nothing else occupies a slot.
    expect(manager.starts).toEqual(["a"])
    manager.complete("a")
    await manager.whenStarted("b")
    expect(manager.starts).toEqual(["a", "b"])
    expect(manager.recordOf("b")?.status).toBe("running")
    manager.complete("b")
    await manager.whenStarted("c")
    manager.complete("c")
    const result = await running

    expect(result.status).toBe("completed")
    expect(result.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "a:completed",
      "b:completed",
      "c:completed",
    ])
  })

  test("#given frontier admission under the residency cap #when a slot frees #then the oldest denial is retried before newer ready nodes", async () => {
    // given - cap 1: b is denied behind a; c becomes ready the moment a completes.
    const manager = new FrontierFakeManager({ residencyLimit: 1 })
    const { scheduler } = frontierFixture(definition([node("a"), node("b"), node("c", ["a"])]), manager)

    // when
    const running = scheduler.run()
    await manager.whenStarted("a")
    expect(manager.attempts).toEqual(["a", "b"])
    manager.complete("a")
    await manager.whenStarted("b")

    // then - the freed slot goes to the oldest denial (b); c probes in the same batch and parks.
    expect(manager.attempts).toEqual(["a", "b", "b", "c"])
    expect(manager.starts).toEqual(["a", "b"])
    manager.complete("b")
    await manager.whenStarted("c")
    expect(manager.attempts).toEqual(["a", "b", "b", "c", "c"])
    manager.complete("c")
    const result = await running

    expect(result.status).toBe("completed")
    expect(result.nodes.every((entry) => entry.state === "completed")).toBe(true)
    expect(result.nodes.find((entry) => entry.id === "b")?.error).toBeUndefined()
  })

  test("#given frontier admission #when the run settles #then every wave index reports exactly one completed grouping with full membership", async () => {
    // given - staggered waves: wave 0 = slow + fast, wave 1 = mid (depends fast), wave 2 = last.
    const manager = new FrontierFakeManager()
    const { scheduler, events } = frontierFixture(
      definition([node("slow"), node("fast"), node("mid", ["fast"]), node("last", ["mid"])]),
      manager,
    )

    // when - fast/mid/last chain settles entirely while slow still runs.
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("slow"), manager.whenStarted("fast")])
    manager.complete("fast")
    await manager.whenStarted("mid")
    manager.complete("mid")
    await manager.whenStarted("last")
    const lastCompleted = whenNodeState(scheduler, "last", "completed")
    manager.complete("last")
    await lastCompleted

    // then - waves 1 and 2 complete while wave 0 stays open; wave 0 completes only when slow
    // settles, and each index reports exactly one completion.
    const completions = events()
      .filter((event): event is Extract<DagRunEvent, { type: "dag.wave.completed" }> => event.type === "dag.wave.completed")
      .map((event) => event.waveIndex)
    expect(completions).toEqual([1, 2])
    manager.complete("slow")
    const result = await running

    expect(result.status).toBe("completed")
    const waveCompletions = events().filter((event): event is Extract<DagRunEvent, { type: "dag.wave.completed" }> =>
      event.type === "dag.wave.completed")
    expect(waveCompletions.map((event) => event.waveIndex)).toEqual([1, 2, 0])
    expect(waveCompletions.find((event) => event.waveIndex === 0)).toMatchObject({ nodeIds: ["slow", "fast"] })
  })
})

describe("DAG scheduler foreign-commit wake (#7412)", () => {
  test("#given a dependent behind a foreign-journaled completion #when no attached settlement fires #then admission wakes and the dependent runs (dag_923ad20e)", async () => {
    // given - a's completion will land through a control-verb journal instance (the incident's
    // revive watcher), NEVER through the scheduler's own attached waitFor.
    const manager = new FrontierFakeManager()
    const { scheduler, events, store } = frontierFixture(definition([node("a"), node("b", ["a"])]), manager)
    const running = scheduler.run()
    await manager.whenStarted("a")
    // The incident node was attached and running when the foreign completion landed; arming any
    // earlier races the scheduler's own started transition, which would clobber the completion.
    await whenNodeState(scheduler, "a", "running")

    // when - a settles outside the scheduler: result persisted, completion journaled foreign.
    const durable = (): DagRunRecordV1 => {
      const record = store.readCheckpoint<DagRunRecordV1>(runId)
      if (record === null) throw new Error("missing durable checkpoint")
      return record
    }
    const child = manager.recordOf("a")
    if (child === undefined) throw new Error("missing fake child for a")
    const terminal = { ...child, status: "completed" as const, final_response: "done a" }
    const persisted = persistDagNodeResult({
      store,
      runId,
      nodeId: "a" as DagNodeId,
      record: terminal,
      now: () => Date.parse("2026-08-25T00:00:03.000Z"),
    })
    expect(persisted.kind).not.toBe("failed")
    const foreign = controlJournal({ store, taskManager: manager, initialRecord: durable() } as DagSchedulerOptions, durable())
    foreign.append(dagNodeTransitionedEvent({ nodeId: "a" as DagNodeId, from: "running", to: "completed", reason: { kind: "succeeded" } }))

    // then - the live scheduler refreshes off the foreign commit and admits b at once.
    await manager.whenStarted("b")
    manager.complete("b")
    const result = await running
    expect(result.status).toBe("completed")
    expect(manager.starts).toEqual(["a", "b"])

    // and - exactly one completed transition for a: the foreign commit, never a stale re-append.
    const aCompletions = events().filter((event) =>
      event.type === "dag.node.transitioned" && String(event.nodeId) === "a" && event.to === "completed")
    expect(aCompletions).toHaveLength(1)
  })
})
