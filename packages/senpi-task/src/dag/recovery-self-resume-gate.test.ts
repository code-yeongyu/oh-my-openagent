// #15133 on #15135, composition (d): recovery re-opens a completed node whose child's latest run was
// self-resumed and ended unfolded only through the attach/fold gate every recovered node passes: never
// beside a live stale claim of that node, which is stopped first; when it cannot be stopped the node
// fails closed with the retryable stale_attempt_alive.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ownedClaims } from "../manager/owned-claims"
import type { TaskRecord } from "../state"
import type { CancelOptions, CancelOutcome } from "../steering"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwnerScope } from "./owner"
import { createDagRecovery } from "./recovery"
import { persistDagNodeResult } from "./results"
import { node, recordFor, runId, SelfResumingTaskManager } from "./scheduler-self-resume.test-harness"
import { createDagFileStore } from "./store"
import type { DagNodeId } from "./types"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// Node A is at attempt 1; its attempt-0 child is still live beside the current claim.
class StaleClaimManager extends SelfResumingTaskManager {
  readonly #stale = new Map<string, TaskRecord>()
  stopLands = false

  addStaleClaim(nodeId: string): string {
    const current = this.taskOf(nodeId)
    if (current.owner === undefined) throw new Error(`task of ${nodeId} has no owner`)
    const taskId = `${current.task_id}-attempt0`
    const { resumed_run_epoch: _resumed, ...base } = current
    this.#stale.set(taskId, {
      ...base,
      task_id: taskId,
      status: "running",
      owner: { ...current.owner, execAttempt: 0 },
    })
    return taskId
  }

  override get(taskId: string): TaskRecord | undefined {
    return this.#stale.get(taskId) ?? super.get(taskId)
  }

  override findOwnedTasks(scope: DagTaskOwnerScope): readonly TaskRecord[] {
    return [...ownedClaims([...this.#stale.values()], scope), ...super.findOwnedTasks(scope)]
  }

  override async cancelTask(taskId: string, reason?: string, options?: CancelOptions): Promise<CancelOutcome> {
    const stale = this.#stale.get(taskId)
    if (stale === undefined) return super.cancelTask(taskId, reason, options)
    this.cancellations.push(taskId)
    if (!this.stopLands) {
      return { kind: "cancel_pending", task_id: taskId, previous_status: stale.status, reason: "unreachable" }
    }
    this.#stale.set(taskId, { ...stale, status: "cancelled" })
    return { kind: "cancelled", task_id: taskId, previous_status: stale.status }
  }
}

function recoveringRunWithStaleClaim(stopLands: boolean) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-recovery-gate-"))
  roots.push(root)
  const store = createDagFileStore(ownedTaskState(root))
  const compiled = recordFor([node("A"), node("B", ["A"])])
  const paused: DagRunRecordV1 & { readonly previousLeaseHolderPid: number } = {
    ...compiled,
    status: "paused",
    previousLeaseHolderPid: 9001,
    nodes: compiled.nodes.map((entry) =>
      entry.id === "A"
        ? {
            ...entry,
            state: "completed",
            taskId: "task-A",
            attempt: 2,
            execAttempt: 1,
            completedAt: compiled.createdAt,
          }
        : entry,
    ),
  }
  store.writeCheckpoint(runId, paused)
  const manager = new StaleClaimManager({ onStart: (nodeId) => queueMicrotask(() => manager.complete(nodeId)) })
  manager.seed("A", "completed")
  manager.complete("A", "completed")
  persistDagNodeResult({ store, runId, nodeId: "A" as DagNodeId, record: manager.taskOf("A") })
  // The current claim's child resumed on its own while no scheduler held the run, and that run failed.
  manager.selfResume("A")
  manager.complete("A", "error")
  const staleTaskId = manager.addStaleClaim("A")
  manager.stopLands = stopLands
  const recovery = createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
  const aTransitions = () =>
    store
      .readEvents(runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.node.transitioned" && String(event.nodeId) === "A")
      .map((event) => (event.type === "dag.node.transitioned" ? `${event.from}->${event.to}` : ""))
  return { manager, recovery, staleTaskId, aTransitions }
}

describe("recovery re-opens a completed node for its ended self-resumed run only through the gate (#12134 on #11381)", () => {
  test("#given a live stale claim of the node that cannot be stopped #when recovery resumes the run #then the node is not re-opened beside it and fails closed stale_attempt_alive", async () => {
    const { manager, recovery, staleTaskId, aTransitions } = recoveringRunWithStaleClaim(false)

    const [outcome] = await recovery.resumePausedRuns("ses-parent")

    expect(aTransitions()).toEqual(["completed->failed"])
    expect(outcome?.record?.nodes.find((entry) => entry.id === "A")?.error?.code).toBe("stale_attempt_alive")
    expect(manager.get(staleTaskId)?.status).toBe("running")
    expect(manager.starts).toEqual([])
  })

  test("#given a live stale claim of the node whose stop lands #when recovery resumes the run #then the stale child is stopped before the node re-opens and folds the resumed failure", async () => {
    const { manager, recovery, staleTaskId, aTransitions } = recoveringRunWithStaleClaim(true)

    const [outcome] = await recovery.resumePausedRuns("ses-parent")

    expect(manager.get(staleTaskId)?.status).toBe("cancelled")
    expect(aTransitions()).toEqual(["completed->running", "running->failed"])
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:failed", "B:skipped"])
    expect(manager.starts).toEqual([])
  })
})
