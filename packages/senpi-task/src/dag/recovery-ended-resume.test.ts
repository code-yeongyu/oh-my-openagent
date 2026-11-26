import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TaskStatus } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { createDagRecovery } from "./recovery"
import { readDagNodeResult } from "./results"
import { createDagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"
import { node, recordFor, runId, SelfResumingTaskManager } from "./scheduler-self-resume.test-harness"
import type { DagNodeId } from "./types"

// #12134: a completed node's child resumed on its own and that resumed run ENDED while the run was
// persisted active but no scheduler held it. Recovery must not keep the stale first result: the
// task record (a self-resumed epoch that ended differently from the node's persisted output) is
// the durable evidence that the node never folded that run.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function interruptedRun(persistedOutput: string, resumedEnd: TaskStatus) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-ended-resume-"))
  roots.push(root)
  const store = createDagFileStore(ownedTaskState(root))
  const compiled = recordFor([node("A"), node("B", ["A"])])
  const paused: DagRunRecordV1 & { readonly previousLeaseHolderPid: number } = {
    ...compiled,
    status: "paused",
    previousLeaseHolderPid: 9001,
    nodes: compiled.nodes.map((entry) =>
      entry.id === "A"
        ? { ...entry, state: "completed", taskId: "task-A", attempt: 1, completedAt: compiled.createdAt }
        : entry,
    ),
  }
  store.writeCheckpoint(runId, paused)
  store.writeResult(runId, "A", persistedOutput)
  const manager = new SelfResumingTaskManager({
    onStart: (nodeId) => queueMicrotask(() => manager.complete(nodeId)),
  })
  manager.seed("A", "completed")
  manager.complete("A")
  manager.selfResume("A")
  manager.complete("A", resumedEnd)
  const recovery = createDagRecovery({ store, taskManager: manager, hostPid: 101, isProcessAlive: () => false })
  const aTransitions = () =>
    store
      .readEvents(runId, 0, { limit: 500 })
      .events.filter((event) => event.type === "dag.node.transitioned" && String(event.nodeId) === "A")
      .map((event) => (event.type === "dag.node.transitioned" ? `${event.from}->${event.to}` : ""))
  return { store, manager, recovery, aTransitions }
}

describe("recovery of an active run whose completed node's resumed run already ended (#12134)", () => {
  test("#given the resumed run failed while no scheduler held the run #when recovery resumes it #then the node folds the failure and its dependent is skipped, never started", async () => {
    const { manager, recovery, aTransitions } = interruptedRun("done A", "error")

    const [outcome] = await recovery.resumePausedRuns("ses-parent")

    expect(manager.starts).toEqual([])
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["A:failed", "B:skipped"])
    expect(outcome?.record?.status).toBe("failed")
    expect(aTransitions()).toEqual(["completed->running", "running->failed"])
  })

  test("#given the resumed run completed with a different answer #when recovery resumes the run #then the node re-folds that answer before its dependent starts", async () => {
    const { store, manager, recovery, aTransitions } = interruptedRun("first answer", "completed")

    const [outcome] = await recovery.resumePausedRuns("ses-parent")

    expect(readDagNodeResult({ store, runId, nodeId: "A" as DagNodeId })?.output).toBe("done A")
    expect(aTransitions()).toEqual(["completed->running", "running->completed"])
    expect(manager.starts).toEqual(["B"])
    expect(outcome?.record?.status).toBe("completed")
  })

  test("#given the resumed run completed with the answer the node already holds #when recovery resumes the run #then the node is reused as it is", async () => {
    const { manager, recovery, aTransitions } = interruptedRun("done A", "completed")

    const [outcome] = await recovery.resumePausedRuns("ses-parent")

    expect(aTransitions()).toEqual([])
    expect(outcome?.reusedOutputs?.get("A" as DagNodeId)).toBe("done A")
    expect(manager.starts).toEqual(["B"])
    expect(outcome?.record?.status).toBe("completed")
  })
})
