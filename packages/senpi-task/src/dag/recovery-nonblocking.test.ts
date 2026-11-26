// Regression for the dag_530ad299 session-restart stall: recovery used to block inside its
// reconcile loop awaiting a still-running reattached child, so `dag.run.resumed` and the reuse
// events of every node ordered after it never appeared and the run sat in `paused` for hours.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  awaitJournalEvents,
  LongRunningTaskManager,
  node,
  owner,
  parentSessionId,
  pausedRecord,
  runId,
  taskRecord,
} from "./__fixtures__/reattached-run"
import type { DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-nonblocking-"))
  cleanupRoots.push(directory)
  return directory
}

describe("DAG resume without blocking on a reattached child", () => {
  test("#given a paused run whose first node is still running #when the session resumes #then reuse and dag.run.resumed land while that child keeps running", async () => {
    // given - the production checkpoint shape: the still-running node is ordered FIRST, so the old
    // blocking reconcile hit it before it ever emitted a reuse event for the completed sibling.
    const projectDir = tempProject()
    const store = createDagFileStore(ownedTaskState(projectDir))
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = {
      key: "nonblocking-resume",
      name: "nonblocking resume",
      nodes: [node("slow"), node("done"), node("next", ["done"])],
    }
    store.writeCheckpoint(
      runId,
      pausedRecord(input, {
        slow: { state: "running", taskId: "task-slow", attempt: 1 },
        done: { state: "completed", taskId: "task-done", attempt: 1 },
        next: { state: "pending" },
      }),
    )
    store.writeResult(runId, "done", "durable done output")
    manager.add(taskRecord(owner("slow"), "running", "task-slow"))
    const reattached: string[] = []
    const recovery = createDagRecovery({
      store,
      taskManager: manager,
      hostPid: 101,
      isProcessAlive: () => false,
      reattach: (_runId, taskId) => reattached.push(taskId),
    })
    const resumeBoundary = awaitJournalEvents(store, ["dag.node.reused", "dag.run.resumed"], 5_000)

    // when - resume runs while task-slow is NEVER completed during this window
    const resume = recovery.resumePausedRuns(parentSessionId)
    const missing = await resumeBoundary.missing
    resumeBoundary.stop()

    // then - the run left "paused" and reused durable work while the child is still running
    const midFlight = store.readCheckpoint<DagRunRecordV1>(runId)
    expect(missing).toEqual([])
    expect(midFlight?.status).toBe("running")
    expect(midFlight?.nodes.find((entry) => entry.id === "slow")?.state).toBe("running")
    expect(manager.get("task-slow")?.status).toBe("running")
    expect(reattached).toContain("task-slow")

    // and then - the reattached child still folds through the normal wave await once it settles,
    // so the DagRecoveryOutcome contract survives unchanged.
    manager.complete("task-slow")
    const [outcome] = await resume
    expect(outcome?.kind).toBe("resumed")
    expect(outcome?.reusedOutputs?.get("done" as DagNodeId)).toBe("durable done output")
    expect(outcome?.record?.status).toBe("completed")
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "slow:completed",
      "done:completed",
      "next:completed",
    ])
    expect(manager.startOwnedCalls).toEqual(["next"])
  }, 30_000)

  test("#given a scheduler built with pre-attached tasks #when a node is retried #then the fresh instance does not re-attach the settled child", async () => {
    // given - a run that already settled through a pre-attached reattachment, with one failed node
    const projectDir = tempProject()
    const store = createDagFileStore(ownedTaskState(projectDir))
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = {
      key: "reentry-guard",
      name: "reentry guard",
      nodes: [node("reattached"), node("broken")],
    }
    const initialRecord = {
      ...pausedRecord(input, {
        reattached: {
          state: "completed",
          taskId: "task-reattached",
          attempt: 1,
          completedAt: "2026-08-25T00:00:02.000Z",
        },
        broken: { state: "failed", taskId: "task-broken", attempt: 1, completedAt: "2026-08-25T00:00:02.000Z" },
      }),
      status: "failed" as const,
    }
    store.writeCheckpoint(runId, initialRecord)
    store.writeResult(runId, "reattached", "durable reattached output")
    manager.add(taskRecord(owner("reattached"), "completed", "task-reattached"))
    const scheduler = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord,
      preAttachedTasks: new Map([["reattached" as DagNodeId, "task-reattached"]]),
    })

    // when - the settled run is re-entered through the retry verb
    const reentry = scheduler.retryNode(runId, ["broken" as DagNodeId])
    const record = await reentry.run

    // then - only the retried node is re-dispatched and the reattached node keeps ONE completion
    expect(manager.startOwnedCalls).toEqual(["broken"])
    expect(record.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "reattached:completed",
      "broken:completed",
    ])
    const reattachedTransitions = store
      .readEvents(runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.node.transitioned" && event.nodeId === "reattached")
    expect(reattachedTransitions).toEqual([])
  }, 30_000)
})
