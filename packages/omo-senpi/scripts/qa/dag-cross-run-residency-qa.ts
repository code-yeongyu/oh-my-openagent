#!/usr/bin/env bun
// Live QA for #8396: two DAG runs in ONE parent session under a real residency cap. Drives the
// REAL composition end to end - a real on-disk task record store, the real createTaskLifecycle
// residency gate (store-record counting, LRU eviction, admission lease), the real admitAdapter
// seam from engine.ts, the real createTaskManager (residencyChanged wake included), the real
// DagFileStore + DagManager, and two real createDagScheduler instances. Only the child runner is
// held by hand so a resident child can be observed occupying its slot. No senpi spawn: same
// precedent as dag-wait-detach-qa.ts and dag-gate-proof.ts. Writes <out-dir>/dag-cross-run-residency-qa.json
// and exits non-zero on any violation.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveOutDir } from "./resolve-out-dir"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createTaskLifecycle,
  createTaskManager,
  createTaskRecordStore,
  type ChildPlanner,
  type ManagedChildHandle,
  type ManagedRunner,
  type ManagedStartSpec,
  type ResidencyRegistry,
  type ResidentHandle,
  type TaskManager,
} from "@oh-my-opencode/senpi-task"
import {
  createDagFileStore,
  createDagManager,
  createDagScheduler,
  type DagDefinition,
  type DagRunEvent,
  type DagRunId,
  type DagScheduler,
} from "@oh-my-opencode/senpi-task/dag"

import { admitAdapter } from "../../src/components/task/engine"

const PARENT_SESSION = "session-cross-run-qa"
const ROOT_SESSION = "session-cross-run-qa"
const RESIDENCY_CAP = 2

const outDir = resolveOutDir("dag-cross-run-residency-qa")
const failures: string[] = []
const report: Record<string, unknown> = { residency_cap: RESIDENCY_CAP }

function check(name: string, condition: boolean, detail: unknown): void {
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`)
}

type HeldChild = {
  readonly name: string
  readonly taskId: string
  readonly settle: () => void
}

// Children stay running until the driver settles them, so run A can hold both slots for as long
// as the scenario needs. Outcomes are queued so a settle that lands before the manager observes
// the handle still reaches it.
class HeldRunner implements ManagedRunner {
  readonly started: HeldChild[] = []
  readonly #startWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    type Outcome = { readonly status: "completed"; readonly finalResponse: string }
    const pending: Outcome[] = []
    const waiters: Array<(outcome: Outcome) => void> = []
    const name = spec.prompt.replace(/^do /, "")
    const handle: ManagedChildHandle = {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => {
        const ready = pending.shift()
        if (ready !== undefined) return Promise.resolve(ready)
        return new Promise<Outcome>((resolve) => waiters.push(resolve))
      },
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }
    this.started.push({
      name,
      taskId: spec.taskId,
      settle: () => {
        const outcome: Outcome = { status: "completed", finalResponse: `done ${name}` }
        const waiter = waiters.shift()
        if (waiter === undefined) pending.push(outcome)
        else waiter(outcome)
      },
    })
    for (const waiter of [...this.#startWaiters]) {
      if (this.started.length >= waiter.count) waiter.resolve()
    }
    return Promise.resolve(handle)
  }

  whenStarted(count: number): Promise<void> {
    if (this.started.length >= count) return Promise.resolve()
    return new Promise((resolve) => this.#startWaiters.push({ count, resolve }))
  }
}

const planner: ChildPlanner = (spec) => ({
  kind: "resolved",
  plan: { model: "qa/held", ...(spec.category === undefined ? {} : { category: spec.category }) },
})

function toResidentHandle(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  return {
    task_id: handle.task_id,
    kind: "in-process",
    pid: undefined,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => Promise.resolve(),
  }
}

function definition(key: string, nodes: DagDefinition["nodes"]): DagDefinition {
  return { key, name: `${key} qa`, nodes }
}

type NodeTransition = Extract<DagRunEvent, { readonly type: "dag.node.transitioned" }>

function whenTransition(scheduler: DagScheduler, nodeId: string, accept: (event: NodeTransition) => boolean): Promise<NodeTransition> {
  return new Promise((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || !accept(event)) return
      unsubscribe()
      resolve(event)
    })
  })
}

const root = fs.mkdtempSync(join(tmpdir(), "dag-cross-run-residency-qa-"))
let lifecycleDispose: (() => void) | undefined
try {
  const taskStore = createTaskRecordStore({ project_dir: root })
  const dagStore = createDagFileStore({ project_dir: root })
  const runner = new HeldRunner()
  const config = OmoTaskSettingsSchema.parse({
    default_concurrency: 16,
    global_concurrency: 0,
    max_depth: 1,
    residency_max_children: RESIDENCY_CAP,
  })
  let managerRef: TaskManager | undefined
  const manager = (): TaskManager => {
    if (managerRef === undefined) throw new Error("manager unavailable")
    return managerRef
  }
  const registry: ResidencyRegistry = {
    get: (taskId) => toResidentHandle(manager().getResidentHandle(taskId)),
    entries: () => manager().residentTaskIds().flatMap((taskId) => {
      const handle = toResidentHandle(manager().getResidentHandle(taskId))
      return handle === undefined ? [] : [handle]
    }),
    forget: (taskId) => manager().forget(taskId),
    hasPendingSends: (taskId) => manager().hasPendingSends?.(taskId) ?? false,
  }
  const lifecycle = createTaskLifecycle({ store: taskStore, registry, config })
  lifecycleDispose = () => lifecycle.dispose?.()
  managerRef = createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: runner },
    planner,
    config,
    cwd: root,
    destruction: { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") },
    admit: (parentSessionId) => admitAdapter(lifecycle, parentSessionId),
  })
  const taskManager = manager()

  let nextRun = 0
  const dagManager = createDagManager({
    store: dagStore,
    newRunId: () => {
      nextRun += 1
      return `dag-cross-run-${nextRun}` as DagRunId
    },
  })
  const startRun = async (input: DagDefinition) => {
    const started = await dagManager.start({ definition: input, parentSessionId: PARENT_SESSION, rootSessionId: ROOT_SESSION })
    const runId = started.snapshot.runId
    const scheduler = createDagScheduler({ store: dagStore, taskManager, initialRecord: dagManager.record(runId, PARENT_SESSION) })
    return { runId, scheduler }
  }
  const liveResidents = (): number => taskStore
    .list()
    .records.filter((record) => record.parent_session_id === PARENT_SESSION && record.residency_state === "resident" &&
      (record.status === "pending" || record.status === "running"))
    .length
  const residentSamples: number[] = []

  // Run A saturates the cap: two leaves start, the third parks behind A's OWN children.
  const runA = await startRun(definition("cross-run-a", [
    { id: "a1", prompt: "do a1", category: "quick" },
    { id: "a2", prompt: "do a2", category: "quick" },
    { id: "a3", prompt: "do a3", category: "quick" },
  ]))
  const runningA = runA.scheduler.run()
  await runner.whenStarted(2)
  residentSamples.push(liveResidents())
  check("run A fills the session cap", liveResidents() === RESIDENCY_CAP, liveResidents())

  // Run B starts with nothing of its own attached while every slot belongs to run A.
  const runB = await startRun(definition("cross-run-b", [
    { id: "b1", prompt: "do b1", category: "quick" },
    { id: "b2", prompt: "do b2", category: "quick", dependsOn: ["b1"] },
  ]))
  const b1Parked = whenTransition(runB.scheduler, "b1", (event) => event.to === "failed" || event.reason.kind === "residency_queued")
  const runningB = runB.scheduler.run()
  const parked = await b1Parked
  report.b1_first_outcome = parked
  check("b1 parks as residency_queued instead of failing", parked.reason.kind === "residency_queued", parked.reason)
  if (parked.reason.kind === "residency_queued") {
    check("residency_queued names the cap holders", parked.reason.residents === RESIDENCY_CAP, parked.reason.residents)
    check("every holder belongs to another owner", parked.reason.heldByOtherOwners === RESIDENCY_CAP, parked.reason.heldByOtherOwners)
  }
  const b1Snapshot = runB.scheduler.snapshot().nodes.find((entry) => String(entry.id) === "b1")
  check("b1 is scheduled while A holds the slots", b1Snapshot?.state === "scheduled", b1Snapshot?.state)
  check("b1 carries no error while parked", b1Snapshot?.error === undefined, b1Snapshot?.error)
  report.run_b_parked_snapshot = runB.scheduler.snapshot().nodes.map((entry) => `${entry.id}:${entry.state}`)

  // Settle children in start order; each settlement frees one slot, and the freed slot must be
  // taken by SOME parked node (A's a3 or B's b1) without any node failing. Five starts in total.
  const startOrder: string[] = []
  for (let index = 0; index < 5; index += 1) {
    await runner.whenStarted(index + 1)
    residentSamples.push(liveResidents())
    const child = runner.started[index]
    if (child === undefined) throw new Error(`missing started child ${index}`)
    startOrder.push(child.name)
    child.settle()
  }
  const [recordA, recordB] = await Promise.all([runningA, runningB])
  report.start_order = startOrder
  report.resident_samples = residentSamples
  report.run_a = recordA.nodes.map((entry) => `${entry.id}:${entry.state}${entry.error === undefined ? "" : `:${entry.error.code}`}`)
  report.run_b = recordB.nodes.map((entry) => `${entry.id}:${entry.state}${entry.error === undefined ? "" : `:${entry.error.code}`}`)
  report.run_a_status = recordA.status
  report.run_b_status = recordB.status

  check("run A completes", recordA.status === "completed", recordA.status)
  check("run B completes", recordB.status === "completed", recordB.status)
  check("no node failed in either run", [...recordA.nodes, ...recordB.nodes].every((entry) => entry.state === "completed"), report.run_b)
  check("no residency_denied error anywhere", [...recordA.nodes, ...recordB.nodes].every((entry) => entry.error?.code !== "residency_denied"), report.run_b)
  check("the real lifecycle never exceeded the cap", residentSamples.every((sample) => sample <= RESIDENCY_CAP), residentSamples)
  check("b1 started only after a slot freed", startOrder.indexOf("b1") >= RESIDENCY_CAP, startOrder)
  const bFailures = dagManager.history({ runId: runB.runId, parentSessionId: PARENT_SESSION, limit: 256 }).events
    .filter((event) => event.type === "dag.node.transitioned" && event.to === "failed")
  check("run B journal has no failed transition", bFailures.length === 0, bFailures)
} finally {
  lifecycleDispose?.()
  fs.mkdirSync(outDir, { recursive: true })
  report.failures = failures
  fs.writeFileSync(join(outDir, "dag-cross-run-residency-qa.json"), JSON.stringify(report, null, 2))
  fs.rmSync(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`dag-cross-run-residency-qa: ${failures.length} violation(s)`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`dag-cross-run-residency-qa: OK (${JSON.stringify({ start_order: report.start_order, run_b: report.run_b })})`)
