// allow: SIZE_OK - the wait/attach acceptance matrix keeps terminal projection, detach safety, and ownership rejections on one real store fixture.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dagRunCancelledEvent, dagRunCompletedEvent, dagRunFailedEvent } from "./events"
import { createDagWaitSurface, DagWaitError } from "./handle"
import { createDagJournal, type DagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNode, DagNodeCounts, DagNodeId, DagRunEvent, DagRunId, DagRunStatus } from "./types"

const cleanupRoots: string[] = []
const parentSessionId = "ses_parent"
const otherSessionId = "ses_other"
const rootSessionId = "ses_root"
const runId = "run-wait" as DagRunId
const at = "2026-01-01T00:00:00.000Z"

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-handle-"))
  cleanupRoots.push(directory)
  return directory
}

function node(id: string, overrides: Partial<DagNode> = {}): DagNode {
  return {
    id: id as DagNodeId,
    prompt: `do ${id}`,
    route: { kind: "category", category: "quick" },
    dependsOn: [],
    state: "pending",
    attempt: 0,
    createdAt: at,
    ...overrides,
  }
}

function record(nodes: readonly DagNode[], status: DagRunStatus = "running"): DagRunRecordV1 {
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
    runKey: "release-plan",
    name: "release plan",
    parentSessionId,
    rootSessionId,
    definitionFingerprint: "fp-1",
    definition: {
      key: "release-plan",
      name: "release plan",
      nodes: nodes.map((entry) => ({
        id: entry.id,
        prompt: entry.prompt,
        category: "quick",
        effectivePrompt: entry.prompt,
      })),
    },
    status,
    generation: 1,
    createdAt: at,
    updatedAt: at,
    nodes,
    edges: [],
    waves: [{ index: 0, nodeIds: nodes.map((entry) => entry.id) }],
    criticalPath: [],
    bottlenecks: [],
    diagnostics: [],
  }
}

function counts(nodes: readonly DagNode[]): DagNodeCounts {
  const tally = {
    total: nodes.length,
    pending: 0,
    blocked: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  }
  for (const entry of nodes) tally[entry.state] += 1
  return tally
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

// Stands in for the scheduler's reducer (todos 9-11): the events under test only need to move the
// run to a terminal status with terminal node states already folded into the checkpoint.
function applyEvent(checkpoint: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  if (event.type === "dag.run.completed") return { ...checkpoint, status: "completed", completedAt: event.at }
  if (event.type === "dag.run.failed") return { ...checkpoint, status: "failed", completedAt: event.at }
  if (event.type === "dag.run.cancelled") return { ...checkpoint, status: "cancelled", completedAt: event.at }
  return checkpoint
}

type Fixture = {
  readonly store: DagFileStore
  readonly journal: DagJournal<DagRunRecordV1>
  readonly surface: ReturnType<typeof createDagWaitSurface>
  readonly settle: (nodes: readonly DagNode[], status: DagRunStatus, reason?: string) => void
}

function fixture(nodes: readonly DagNode[], overrides: { readonly cancel?: (id: DagRunId, reason?: string) => void } = {}): Fixture {
  const store = createDagFileStore({ project_dir: tempProject() })
  const initial = record(nodes)
  store.writeCheckpoint(runId, initial)
  const journal = createDagJournal<DagRunRecordV1>({ store, runId, initialCheckpoint: initial, applyEvent })
  const surface = createDagWaitSurface({
    store,
    subscribe: (subscribedRunId, listener) => {
      if (subscribedRunId !== runId) return () => undefined
      return journal.subscribe(listener)
    },
    ...(overrides.cancel === undefined ? {} : { cancel: overrides.cancel }),
  })
  return {
    store,
    journal,
    surface,
    settle(settledNodes, status, reason) {
      const current = journal.snapshot()
      store.writeCheckpoint(runId, { ...current, nodes: settledNodes })
      if (status === "completed") journal.append(dagRunCompletedEvent({ counts: counts(settledNodes) }))
      else if (status === "failed") {
        journal.append(dagRunFailedEvent({
          error: { code: "task_error", message: "build failed", nodeId: "build" as DagNodeId, at },
          counts: counts(settledNodes),
        }))
      } else journal.append(dagRunCancelledEvent({ counts: counts(settledNodes), ...(reason === undefined ? {} : { reason }) }))
    },
  }
}

describe("createDagWaitSurface wait terminal projection", () => {
  test("#given a two node run #when both nodes complete #then wait resolves with each node output and run stats", async () => {
    // given
    const running = [node("plan", { state: "running", taskId: "task-plan" }), node("build", { state: "running", taskId: "task-build" })]
    const harness = fixture(running)
    harness.store.writeResult(runId, "plan", "plan output")
    harness.store.writeResult(runId, "build", "build output")

    // when
    const waiting = harness.surface.wait(runId, parentSessionId)
    harness.settle(
      [
        node("plan", { state: "completed", taskId: "task-plan", completedAt: at, runStats: { runtime_ms: 10, turns: 2, tool_calls: 1 } }),
        node("build", { state: "completed", taskId: "task-build", completedAt: at }),
      ],
      "completed",
    )
    const result = await waiting

    // then
    expect(result.status).toBe("completed")
    expect(result.runId).toBe(runId)
    expect(result.snapshot.status).toBe("completed")
    expect(result.nodes).toEqual({
      plan: { state: "completed", taskId: "task-plan", output: "plan output", runStats: { runtime_ms: 10, turns: 2, tool_calls: 1 } },
      build: { state: "completed", taskId: "task-build", output: "build output" },
    })
  })

  test("#given a failed node with a dependent #when the run ends failed #then wait resolves with the node error and the dependency skip", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" }), node("ship", { state: "blocked", dependsOn: ["plan" as DagNodeId] })])

    // when
    const waiting = harness.surface.wait(runId, parentSessionId)
    harness.settle(
      [
        node("plan", {
          state: "failed",
          taskId: "task-plan",
          error: { code: "task_error", message: "plan crashed", nodeId: "plan" as DagNodeId, at },
        }),
        node("ship", { state: "skipped", dependsOn: ["plan" as DagNodeId] }),
      ],
      "failed",
    )
    const result = await waiting

    // then
    expect(result.status).toBe("failed")
    expect(result.nodes).toEqual({
      plan: {
        state: "failed",
        taskId: "task-plan",
        error: { code: "task_error", message: "plan crashed", nodeId: "plan" as DagNodeId, at },
      },
      ship: { state: "skipped", dependencyIds: ["plan" as DagNodeId] },
    })
  })

  test("#given a cancelled run #when wait is pending #then it resolves rather than rejects and carries the cancellation reason", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" }), node("build", { state: "pending" })])

    // when
    const waiting = harness.surface.wait(runId, parentSessionId)
    harness.settle(
      [
        node("plan", { state: "cancelled", taskId: "task-plan" }),
        node("build", { state: "cancelled" }),
      ],
      "cancelled",
      "user_requested",
    )
    const result = await waiting

    // then
    expect(result.status).toBe("cancelled")
    expect(result.nodes).toEqual({
      plan: { state: "cancelled", taskId: "task-plan", reason: "user_requested" },
      build: { state: "cancelled", reason: "user_requested" },
    })
  })

  test("#given a run that is already terminal #when wait is called #then it resolves without any further journal event", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])
    harness.store.writeResult(runId, "plan", "plan output")
    harness.settle([node("plan", { state: "completed", taskId: "task-plan" })], "completed")
    const seqBefore = harness.store.readEvents(runId, 0, { limit: 100 }).headSeq

    // when
    const result = await harness.surface.wait(runId, parentSessionId)

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.plan).toEqual({ state: "completed", taskId: "task-plan", output: "plan output" })
    expect(harness.store.readEvents(runId, 0, { limit: 100 }).headSeq).toBe(seqBefore)
  })

  test("#given a run terminalizes during live subscription setup #when wait registers #then the final checkpoint read resolves without an event callback", async () => {
    // given
    const store = createDagFileStore({ project_dir: tempProject() })
    const running = record([node("plan", { state: "running", taskId: "task-plan" })])
    store.writeCheckpoint(runId, running)
    store.writeResult(runId, "plan", "plan output")
    const completed = {
      ...running,
      status: "completed",
      completedAt: at,
      nodes: [node("plan", { state: "completed", taskId: "task-plan", completedAt: at })],
    } satisfies DagRunRecordV1
    const surface = createDagWaitSurface({
      store,
      subscribe: () => {
        store.writeCheckpoint(runId, completed)
        return () => undefined
      },
    })

    // when
    const result = await within(surface.wait(runId, parentSessionId))

    // then
    expect(result.status).toBe("completed")
    expect(result.nodes.plan).toEqual({ state: "completed", taskId: "task-plan", output: "plan output" })
    expect(surface.waiterCount(runId)).toBe(0)
  })
})

describe("createDagWaitSurface attach", () => {
  test("#given an attached handle #when done resolves #then it equals the wait result and snapshot tracks the live record", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])
    harness.store.writeResult(runId, "plan", "plan output")
    const handle = harness.surface.attach(runId, parentSessionId)

    // when
    expect(handle.snapshot().status).toBe("running")
    const viaHandle = handle.done()
    const viaWait = harness.surface.wait(runId, parentSessionId)
    harness.settle([node("plan", { state: "completed", taskId: "task-plan" })], "completed")
    const [handleResult, waitResult] = await Promise.all([viaHandle, viaWait])

    // then
    expect(handle.runId).toBe(runId)
    expect(handleResult).toEqual(waitResult)
    expect(handle.snapshot().status).toBe("completed")
  })

  test("#given an attached handle #when cancel is called #then the injected cancellation runs for the owned run only", async () => {
    // given
    const cancelled: { runId: DagRunId; reason?: string }[] = []
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })], {
      cancel: (id, reason) => {
        cancelled.push(reason === undefined ? { runId: id } : { runId: id, reason })
      },
    })

    // when
    await harness.surface.attach(runId, parentSessionId).cancel("user_requested")

    // then
    expect(cancelled).toEqual([{ runId, reason: "user_requested" }])
    expect(() => harness.surface.attach(runId, otherSessionId)).toThrow(DagWaitError)
  })
})

describe("createDagWaitSurface detach safety", () => {
  test("#given a caller that abandons its wait promise #when the run later completes #then the run is untouched and a fresh attach still returns the result", async () => {
    // given
    const cancelled: DagRunId[] = []
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })], {
      cancel: (id) => {
        cancelled.push(id)
      },
    })
    harness.store.writeResult(runId, "plan", "plan output")

    // when
    let abandonedSettled = false
    const abandoned = harness.surface.wait(runId, parentSessionId)
    void abandoned.then(() => {
      abandonedSettled = true
    })
    await Promise.resolve()
    harness.settle([node("plan", { state: "completed", taskId: "task-plan" })], "completed")
    const later = await harness.surface.attach(runId, parentSessionId).done()

    // then
    expect(cancelled).toEqual([])
    expect(harness.store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("completed")
    expect(later.nodes.plan).toEqual({ state: "completed", taskId: "task-plan", output: "plan output" })
    await abandoned
    expect(abandonedSettled).toBe(true)
  })

  test("#given many waiters on one run #when every waiter detaches but one #then the survivor still resolves and no journal subscription leaks", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])
    harness.store.writeResult(runId, "plan", "plan output")

    // when
    const abandonedFirst = harness.surface.wait(runId, parentSessionId)
    const abandonedSecond = harness.surface.wait(runId, parentSessionId)
    const survivor = harness.surface.wait(runId, parentSessionId)
    harness.settle([node("plan", { state: "completed", taskId: "task-plan" })], "completed")

    // then
    expect((await survivor).status).toBe("completed")
    expect(harness.surface.waiterCount(runId)).toBe(0)
    await Promise.all([abandonedFirst, abandonedSecond])
  })
})

describe("createDagWaitSurface pre-dispatch rejections", () => {
  test("#given a run owned by a dead session #when a new session waits #then it rejects with run_not_owned instead of hanging", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])

    // when
    const foreign = harness.surface.wait(runId, otherSessionId)

    // then
    await expect(foreign).rejects.toThrow(DagWaitError)
    await foreign.catch((error: unknown) => {
      expect(error).toMatchObject({ code: "run_not_owned", runId })
    })
  })

  test("#given an unknown run id #when waited or attached #then run_not_found is raised before any subscription", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])
    const missing = "run-missing" as DagRunId

    // when
    const waiting = harness.surface.wait(missing, parentSessionId)

    // then
    await expect(waiting).rejects.toMatchObject({ code: "run_not_found" })
    expect(() => harness.surface.attach(missing, parentSessionId)).toThrow(DagWaitError)
  })

  test("#given malformed wait params #when waited #then invalid_arguments is raised and no run is touched", async () => {
    // given
    const harness = fixture([node("plan", { state: "running", taskId: "task-plan" })])

    // when
    const blankRun = harness.surface.wait("" as DagRunId, parentSessionId)
    const blankSession = harness.surface.wait(runId, "")

    // then
    await expect(blankRun).rejects.toMatchObject({ code: "invalid_arguments" })
    await expect(blankSession).rejects.toMatchObject({ code: "invalid_arguments" })
    expect(harness.store.readCheckpoint<DagRunRecordV1>(runId)?.status).toBe("running")
  })
})
