// A workflow run over the live-parent lifecycle fixture: real task manager, real lifecycle (session-start
// reconcile, live-parent recovery on its controllable clock) and real DAG recovery over one store, so a
// test drives the exact session-start order - lifecycle reconcile first, workflow recovery after it.
import { expect } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { liveParentFixture } from "../../lifecycle/__fixtures__/live-parent-fakes"
import { ownedTaskState } from "../../store/__fixtures__/owned-task-state"
import type { DagDefinition } from "../graph"
import { subscribeDagJournal } from "../journal"
import type { DagRunRecordV1 } from "../manager"
import { createDagRecovery, type InstalledDagRun } from "../recovery"
import { createDagFileStore, type DagFileStore } from "../store"
import type { DagNode } from "../types"
import { node, owner, pausedRecord, runId } from "./reattached-run"

export const PARENT = "parent-1"
const DEAD_HOST_PID = 9001
const roots: string[] = []

export function cleanupPendingRevivalRuns(): void {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
}

type Fixture = ReturnType<typeof liveParentFixture>

// k-hang -> k-after: the observed run shape. Its host died mid-run, so the checkpoint still reads
// `running` under a dead holder and recovery claims it like a paused run.
export const hangThenAfter: DagDefinition = {
  key: "pending-revival",
  name: "pending revival",
  nodes: [node("k-hang"), node("k-after", ["k-hang"])],
}

export function seedRun(f: Fixture, children: Readonly<Record<string, string>>): DagFileStore {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-pending-revival-"))
  roots.push(directory)
  const store = createDagFileStore(ownedTaskState(directory))
  const states: Record<string, Partial<DagNode>> = {}
  for (const entry of hangThenAfter.nodes) {
    const taskId = children[entry.id]
    if (taskId !== undefined) f.store.mutate(taskId, (record) => ({ ...record, owner: owner(entry.id) }))
    states[entry.id] = taskId === undefined ? { state: "pending" } : { state: "running", taskId, attempt: 1 }
  }
  const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(hangThenAfter, states)
  store.writeCheckpoint(runId, {
    ...paused,
    parentSessionId: PARENT,
    rootSessionId: PARENT,
    status: "running",
    leaseHolderPid: DEAD_HOST_PID,
  })
  return store
}

/** Workflow recovery as the session-start sweep runs it, over the fixture's CURRENT manager and lifecycle. */
export async function recoverRun(f: Fixture, store: DagFileStore): Promise<InstalledDagRun> {
  const recovery = createDagRecovery({
    store,
    taskManager: f.manager,
    hostPid: process.pid,
    isProcessAlive: () => false,
    isRunHeldInProcess: () => false,
    ...(f.lifecycle.pendingRevivals === undefined ? {} : { pendingRevivals: f.lifecycle.pendingRevivals }),
  })
  const installed: InstalledDagRun[] = []
  await recovery.installPausedRuns(PARENT, (run) => {
    installed.push(run)
    run.release()
  })
  const [run] = installed
  if (run === undefined) throw new Error("workflow recovery claimed no run")
  return run
}

export function nodeStates(store: DagFileStore): readonly string[] {
  const record = store.readCheckpoint<DagRunRecordV1>(runId)
  return record?.nodes.map((entry) => [entry.id, entry.state, entry.error?.code].filter(Boolean).join(":")) ?? []
}

export function nodeError(store: DagFileStore, nodeId: string): string | undefined {
  return store.readCheckpoint<DagRunRecordV1>(runId)?.nodes.find((entry) => entry.id === nodeId)?.error?.message
}

/** The task id the run attaches to `nodeId`, observed on the journal (subscribed before the action). */
export function attachedTask(store: DagFileStore, nodeId: string): Promise<string> {
  const attached = Promise.withResolvers<string>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type !== "dag.node.task-attached" || event.nodeId !== nodeId) return
    stop()
    attached.resolve(event.taskId)
  })
  return attached.promise
}

const OLDER = "2026-10-08T00:00:00.000Z"

/** Quit with two running children, reopen with one residency slot: the workflow child is deferred. */
export async function reopenOverCapacity(f: Fixture) {
  const hang = await f.start()
  const side = await f.start()
  await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT, reason: "quit" })
  f.store.mutate(hang, (record) => ({ ...record, updated_at: OLDER }))
  const store = seedRun(f, { "k-hang": hang })
  f.state.revivable = true
  const reconciled = await f.restart().reconcileOnSessionStart(PARENT)
  expect(reconciled.outcomes.find((outcome) => outcome.task_id === hang)).toMatchObject({
    kind: "deferred",
    reason: "capacity",
  })
  return { hang, side, store }
}

/** The host died with the child mid-run; on reopen the task host does not answer yet. */
export async function reopenWithTaskHostDown(f: Fixture) {
  const hang = await f.start()
  const store = seedRun(f, { "k-hang": hang })
  f.host.daemon.alive = false
  await f.restart().reconcileOnSessionStart(PARENT)
  expect(f.store.load(hang)).toMatchObject({
    status: "running",
    residency_state: "rpc_detached",
    suspension_reason: "daemon_unavailable",
  })
  expect(f.store.load(hang)?.recovery_deadline_at).toBeDefined()
  return { hang, store }
}

/** Ends the side child and releases its slot, the way a finished child is parked. */
export async function freeSlot(f: Fixture, side: string): Promise<void> {
  f.resumedHandles.get(side)?.settle({ status: "completed", finalResponse: "side done" })
  await f.manager.waitFor(side)
  await f.lifecycle.parkTerminalResident(side)
}

/** One live-parent retry tick of the lifecycle's own timer, awaited to its attempt. */
export async function lifecycleRetryTick(f: Fixture): Promise<void> {
  const attempted = f.wait("live_parent_recovery_attempt")
  f.advance(5_000)
  await attempted
}

/** Finishes the revived k-hang child and then the k-after child the run starts behind it. */
export async function finishRun(f: Fixture, store: DagFileStore, hang: string): Promise<void> {
  const after = attachedTask(store, "k-after")
  f.resumedHandles.get(hang)?.settle({ status: "completed", finalResponse: "hang done" })
  const afterTask = await after
  f.runner.handles.get(afterTask)?.settle({ status: "completed", finalResponse: "after done" })
}
