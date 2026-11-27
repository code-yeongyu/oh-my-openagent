// #15150 stacked on #15135/#15133/#15138: a node waiting for its child's pending revival composes with
// the stack's one owner-liveness function, the self-resume follow and the one child gate.
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, seedRecord } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "../lifecycle/__fixtures__/live-parent-fakes"
import { createOwnerProcessView } from "../lifecycle/owner-process"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import {
  cleanupPendingRevivalRuns,
  finishRun,
  freeSlot,
  lifecycleRetryTick,
  nodeStates,
  PARENT,
  recoverRun,
  reopenOverCapacity,
  seedRun,
} from "./__fixtures__/pending-revival-run"
import { runId } from "./__fixtures__/reattached-run"
import { subscribeDagJournal } from "./journal"
import { readDagNodeResult } from "./results"
import type { DagFileStore } from "./store"
import type { DagNodeId } from "./types"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function fixture(...args: Parameters<typeof liveParentFixture>) {
  const f = liveParentFixture(...args)
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupPendingRevivalRuns()
  cleanupProjects()
  cleanupManagers()
})

const WAITING = ["k-hang:running", "k-after:pending"]

function nodeTransitions(store: DagFileStore, nodeId: string): readonly string[] {
  return store
    .readEvents(runId, 0, { limit: 500, types: ["dag.node.transitioned"] })
    .events.flatMap((event) =>
      event.type === "dag.node.transitioned" && event.nodeId === nodeId ? [`${event.from}->${event.to}`] : [],
    )
}

/** Resolves on the node's next transition to `to`, subscribed before the action that causes it. */
function transitionTo(store: DagFileStore, nodeId: string, to: string): Promise<undefined> {
  const seen = Promise.withResolvers<undefined>()
  const stop = subscribeDagJournal(store, runId, (event) => {
    if (event.type !== "dag.node.transitioned" || event.nodeId !== nodeId || event.to !== to) return
    stop()
    seen.resolve(undefined)
  })
  return seen.promise
}
const OWNER_PID = 4444
const CLAIMED_START = "linux-proc-start-ticks:100"
const REUSED_START = "linux-proc-start-ticks:999"

/** A live child of this run (its owner names it) for a node the run no longer has, under another session. */
function seedStaleChildOfRemovedNode(f: ReturnType<typeof liveParentFixture>): void {
  seedRecord(f.store, {
    task_id: "st_0000cafe",
    parent_session_id: "another-session",
    status: "running",
    residency_state: "resident",
  })
  f.store.mutate("st_0000cafe", (record) => ({
    ...record,
    owner: { kind: "dag", runId, nodeId: "k-gone" as DagNodeId, fingerprint: "removed-node" },
  }))
}

/** The host died with the child mid-turn; its record still claims an owner pid the OS reports alive. */
async function deadHostChildClaimedBy(observedStart: string) {
  const f = fixture("in-process")
  const hang = await f.start()
  const store = seedRun(f, { "k-hang": hang })
  f.store.mutate(hang, (record) => ({
    ...record,
    residency_state: "resident",
    host_pid: OWNER_PID,
    host_claim: { pid: OWNER_PID, at: "2026-11-27T00:00:00.000Z", start: CLAIMED_START },
  }))
  f.alivePids.add(OWNER_PID)
  const ownerProcesses = createOwnerProcessView(async (pid) => (pid === OWNER_PID ? observedStart : null))
  f.state.revivable = false
  await f.restart({ ownerProcesses }).reconcileOnSessionStart(PARENT)
  return { f, hang, store, ownerProcesses }
}

describe("a waiting node on the stacked engine (#15150, stack)", () => {
  test("#given the child's owner pid was reused by another process #when the session reopens #then the lifecycle owns the revival and the node waits for it and follows it", async () => {
    // given - the owner's start contradicts the claim's stamp: the one owner rule calls it dead
    const { f, hang, store, ownerProcesses } = await deadHostChildClaimedBy(REUSED_START)

    // when
    const run = await recoverRun(f, store, { ownerProcesses })

    // then
    expect(nodeStates(store)).toEqual(WAITING)
    f.state.revivable = true
    await lifecycleRetryTick(f)
    await finishRun(f, store, hang)
    expect((await run.settled).record?.status).toBe("completed")
  })

  test("#given the child's owner is the live process its stamp names #when the session reopens #then no waiting node is made for a revival another process holds", async () => {
    // given
    const { f, hang, store, ownerProcesses } = await deadHostChildClaimedBy(CLAIMED_START)

    // when
    const recovered = await recoverRun(f, store, { ownerProcesses }).then(
      (run) => ({ run }),
      () => ({ run: undefined }),
    )

    // then - the lifecycle owes nothing for a child a live process holds; the node is never left waiting
    expect(f.lifecycle.pendingRevivals?.obligation(hang)).toBe("none")
    expect(nodeStates(store)).not.toEqual(WAITING)
    await recovered.run?.scheduler.suspend()
  })

  test("#given a waiting node whose child is revived, settles and then starts a turn on its own #when that turn ends #then the node follows it once and ends with the final answer", async () => {
    // given
    const f = fixture("in-process", { residency_max_children: 1, default_concurrency: 2 })
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    const revived = f.resumedHandles.get(hang)
    expect(revived).toBeDefined()
    const firstFold = transitionTo(store, "k-hang", "completed")
    revived?.settle({ status: "completed", finalResponse: "first answer" })
    await firstFold

    // when - the child resumes on its own, then ends with the final answer
    const reopened = transitionTo(store, "k-hang", "running")
    revived?.selfResume()
    await bounded(reopened)
    const final = transitionTo(store, "k-hang", "completed")
    revived?.settle({ status: "completed", finalResponse: "final answer" })
    await final

    // then - one fold per run of the child, one follow, the final answer last
    expect(nodeTransitions(store, "k-hang")).toEqual(["running->completed", "completed->running", "running->completed"])
    expect(readDagNodeResult({ store, runId, nodeId: "k-hang" as DagNodeId })?.output).toBe("final answer")
    await run.scheduler.suspend()
  })

  test("#given a live child of a node the run no longer has when the session reopens #when recovery runs #then the fence stops it first and the pending node still waits and then follows its child", async () => {
    // given - recovery's order: the child gate's fence (rule 1) runs before any node is resolved
    const f = fixture("in-process", { residency_max_children: 1, default_concurrency: 2 })
    const { hang, side, store } = await reopenOverCapacity(f)
    seedStaleChildOfRemovedNode(f)

    // when
    const run = await recoverRun(f, store)

    // then - the stale child was stopped by the fence; the waiting branch was not touched by it
    expect(f.store.load("st_0000cafe")?.status).toBe("cancelled")
    expect(nodeStates(store)).toEqual(WAITING)
    await freeSlot(f, side)
    await lifecycleRetryTick(f)
    await finishRun(f, store, hang)
    expect((await run.settled).record?.status).toBe("completed")
  })

  test("#given a waiting node and a live child of a node the run no longer has #when the waiting child is revived #then the child gate refuses to follow it: the node fails and the revived child is stopped", async () => {
    // given
    const f = fixture("in-process", { residency_max_children: 1, default_concurrency: 2 })
    const { hang, side, store } = await reopenOverCapacity(f)
    const run = await recoverRun(f, store)
    seedStaleChildOfRemovedNode(f)

    // when
    await freeSlot(f, side)
    await lifecycleRetryTick(f)

    // then
    expect((await bounded(run.settled)).record?.status).toBe("failed")
    expect(nodeStates(store)).toEqual(["k-hang:failed:stale_attempt_alive", "k-after:skipped"])
    expect(f.store.load(hang)?.status).toBe("cancelled")
  })
})
