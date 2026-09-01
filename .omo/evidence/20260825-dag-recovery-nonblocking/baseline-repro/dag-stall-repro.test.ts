
// REPRO for the 2026-08-25 dag_530ad299 stall (sisyphuslabs "omo startup fixes PR wave").
// Two failing-first proofs:
//  R1: session-restart recovery blocks inside reconcileNodes awaiting a still-running
//      reattached child, so dag.run.resumed (and reuse events for nodes ordered after it)
//      never appear and the run stays "paused" indefinitely.
//  R2: a dependent whose dependsOn are ALL completed is never admitted while an unrelated
//      wave-0 sibling still runs (strict wave barrier vs documented dependency semantics).
import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagRecovery } from "./recovery"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

const parentSessionId = "session-parent"
const rootSessionId = "session-root"
const runId = "run-stall-repro" as DagRunId

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

function tempProject(): string {
  return fs.mkdtempSync(join(tmpdir(), "senpi-dag-stall-repro-"))
}

function node(id: string, dependsOn: readonly string[] = []) {
  return { id, prompt: `do ${id}`, category: "quick", ...(dependsOn.length === 0 ? {} : { dependsOn }) } as const
}

function record(
  input: DagDefinition,
  states: Readonly<Record<string, Partial<DagNode>>>,
  overrides: Partial<DagRunRecordV1> & { readonly previousLeaseHolderPid?: number } = {},
): DagRunRecordV1 {
  const createdAt = "2026-08-25T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("repro DAG did not compile")
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
    nodes: compiled.nodes.map((entry) => ({ ...entry, ...states[String(entry.id)] })),
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
    ...overrides,
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

class StallFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly #tasks = new Map<string, MutableTask>()

  add(rec: TaskRecord): void {
    const completion = deferred<TaskRecord>()
    this.#tasks.set(rec.task_id, { record: rec, completion })
    if (rec.status !== "pending" && rec.status !== "running") completion.resolve(rec)
  }

  complete(taskId: string): void {
    const task = this.#tasks.get(taskId)
    if (task === undefined) throw new Error(`unknown fake task ${taskId}`)
    task.record = { ...task.record, status: "completed", final_response: `done ${taskId}` }
    task.completion.resolve(task.record)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.starts.push(String(owner.nodeId))
    const existing = this.findOwnedTask(owner)
    if (existing !== undefined) {
      return { kind: "started", reused: true, task_id: existing.task_id, status: existing.status, name: existing.name ?? existing.task_id }
    }
    const rec = taskRecord(owner, "running")
    this.add(rec)
    return { kind: "started", reused: false, task_id: rec.task_id, status: "running", name: rec.name ?? rec.task_id }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find(({ record: rec }) =>
      rec.owner?.kind === owner.kind && rec.owner.runId === owner.runId && rec.owner.nodeId === owner.nodeId,
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

function events(store: DagFileStore): readonly DagRunEvent[] {
  return store.readEvents(runId, 0, { limit: 200 }).events
}

describe("dag_530ad299 stall repro", () => {
  test("R1: resume emits dag.run.resumed and reuses completed nodes even while a reattached child is still running", async () => {
    // given - mirrors the production checkpoint at seq26: one node still running (lane-c),
    // completed siblings with durable results (lane-a/d/e/f), a pending dependent (lane-b).
    // Node order puts the running node FIRST so reconcile hits the blocking await before
    // any reuse event, exactly like lane-c blocking lane-d/e/f reuse in production.
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new StallFakeManager()
    const input: DagDefinition = {
      key: "stall-repro",
      name: "stall repro",
      nodes: [node("lane-c"), node("lane-a"), node("lane-b", ["lane-a"])],
    }
    const rec = record(input, {
      "lane-c": { state: "running", taskId: "task-lane-c", attempt: 1 },
      "lane-a": { state: "completed", taskId: "task-lane-a", attempt: 1 },
      "lane-b": { state: "pending" },
    }, { status: "paused", previousLeaseHolderPid: 9001 })
    store.writeCheckpoint(runId, rec)
    store.writeResult(runId, "lane-a", "durable lane-a output")
    manager.add(taskRecord(owner("lane-c"), "running", "task-lane-c")) // NEVER completed during the window
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => false,
    })

    // when - resume starts while the reattached child keeps running (production: lane-c
    // sat in a polling bash for 20+ minutes; here we give recovery 400ms of wall clock).
    const resume = recovery.resumePausedRuns(parentSessionId)
    await sleep(400)

    // then - the run must show life while the child still runs: the resumed boundary event
    // and the reuse of already-completed durable results must NOT wait for the running child.
    const seen = events(store).map((event) => event.type)
    expect(seen).toContain("dag.node.reused")   // lane-a durable result reused
    expect(seen).toContain("dag.run.resumed")   // run leaves "paused" while child still runs

    // cleanup - let the child finish so resume can settle (green path after the fix).
    manager.complete("task-lane-c")
    await resume
  }, 10_000)

  test("R2: a dependent whose dependsOn are all completed is admitted while an unrelated wave-0 sibling still runs", async () => {
    // given - lane-a and lane-c share wave 0; lane-b depends ONLY on lane-a.
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const manager = new StallFakeManager()
    const input: DagDefinition = {
      key: "barrier-repro",
      name: "barrier repro",
      nodes: [node("lane-a"), node("lane-c"), node("lane-b", ["lane-a"])],
    }
    const scheduler = createDagScheduler({ store, taskManager: manager, initialRecord: record(input, {}) })

    // when - lane-a completes quickly; lane-c keeps running (production: 2h+).
    const run = scheduler.run()
    await sleep(50)
    manager.complete("task-lane-a")
    await sleep(400)

    // then - documented semantics: "a node starts only after every node it dependsOn has
    // finished" - lane-a IS finished, so lane-b should be admitted despite lane-c running.
    expect(manager.starts).toContain("lane-b")

    // cleanup - finish remaining tasks so the run settles.
    manager.complete("task-lane-c")
    await sleep(50)
    if (!manager.starts.includes("lane-b")) {
      // barrier released lane-b only now; let it finish
      await sleep(100)
    }
    const lane_b = manager.findOwnedTask({ kind: "dag", runId, nodeId: "lane-b" as DagNodeId })
    if (lane_b !== undefined && lane_b.status === "running") manager.complete(lane_b.task_id)
    await run
  }, 10_000)
})
