// #15150 on #15125: a recovered scheduler that holds only a node WAITING for its child's revival fails.
// The first failure hands the run to recovery, which re-reads the lifecycle's obligation and waits again.
// A repeated failure parks the run: the park is a deliberate stop (like cancel), so it ends the child -
// which ends the lifecycle's obligation - and fails the node with the real reason; no revived child can
// then run with no node following it, and the run never stays running and unheld.
import { afterEach, describe, expect, test } from "bun:test"

import { createDagRecovery, type InstalledDagRun } from "@oh-my-opencode/senpi-task/dag"

import { DAG_SCHEDULER_FAILED_PAUSE_REASON } from "../../../../senpi-task/src/dag/events"
import {
  cleanupPendingRevivalRuns,
  nodeStates,
  PARENT,
  reopenOverCapacity,
} from "../../../../senpi-task/src/dag/__fixtures__/pending-revival-run"
import { runId } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { createDagRunReservations } from "../../../../senpi-task/src/dag/run-reservations"
import { cleanupProjects } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "../../../../senpi-task/src/lifecycle/__fixtures__/live-parent-fakes"
import { cleanupProjects as cleanupManagers } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { endedChildClosure } from "./dag-paused-cancel"
import { createSchedulerFailureHandler } from "./dag-scheduler-failure"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupPendingRevivalRuns()
  cleanupProjects()
  cleanupManagers()
})

async function waitingRunWithFailureHandler() {
  const f = liveParentFixture("in-process", { residency_max_children: 1, default_concurrency: 2 })
  fixtures.push(f)
  const { hang, store } = await reopenOverCapacity(f)
  const reservations = createDagRunReservations()
  const isProcessAlive = () => false
  const holder: { run?: InstalledDagRun } = {}
  const recovery = createDagRecovery({
    store,
    taskManager: f.manager,
    hostPid: process.pid,
    isProcessAlive,
    isRunHeldInProcess: () => holder.run !== undefined,
    reservations,
    ...(f.lifecycle.pendingRevivals === undefined ? {} : { pendingRevivals: f.lifecycle.pendingRevivals }),
  })
  const recover = (sessionId: string) =>
    recovery.installPausedRuns(sessionId, (run) => {
      holder.run = run
      run.release()
    })
  const handler = createSchedulerFailureHandler({
    schedulerOptions: { store, taskManager: f.manager, hostPid: process.pid, isProcessAlive, reservations },
    reservations,
    probe: { taskManager: f.manager, hostPid: process.pid, isProcessAlive },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    holdsRun: () => holder.run !== undefined,
    children: f.manager,
    closure: endedChildClosure(f.manager),
    recover,
  })
  // The scheduler of this process ends with an error: it is gone, and the failure is reported.
  const failScheduler = async () => {
    const failed = holder.run
    holder.run = undefined
    await failed?.scheduler.suspend()
    await handler.failed(runId, PARENT, "scheduler fault")
  }
  await recover(PARENT)
  return { f, hang, store, holder, failScheduler }
}

describe("a scheduler failure over a node waiting for its child's revival (#15150 on #15125)", () => {
  test("#given a waiting node #when its scheduler fails once #then recovery takes the run again and the node waits again", async () => {
    // given
    const { f, hang, store, holder, failScheduler } = await waitingRunWithFailureHandler()
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])

    // when
    await failScheduler()

    // then
    expect(holder.run).toBeDefined()
    expect(nodeStates(store)).toEqual(["k-hang:running", "k-after:pending"])
    expect(f.lifecycle.pendingRevivals?.obligation(hang)).toBe("owed")
    await holder.run?.scheduler.suspend()
  })

  test("#given a waiting node #when its scheduler fails again #then the park ends the child, fails the node with the real reason and pauses the run unheld", async () => {
    // given
    const { f, hang, store, failScheduler } = await waitingRunWithFailureHandler()
    await failScheduler()

    // when
    await failScheduler()

    // then
    const record = store.readCheckpoint<DagRunRecordV1 & { readonly leaseHolderPid?: number }>(runId)
    expect(record?.status).toBe("paused")
    expect(store.readEvents(runId, 0, { limit: 500 }).events.at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }),
    )
    expect(record?.leaseHolderPid).toBeUndefined()
    expect(nodeStates(store)).toEqual(["k-hang:failed:task_cancelled", "k-after:pending"])
    expect(record?.nodes[0]?.error?.message).toContain("scheduler fault")
    expect(f.store.load(hang)?.status).toBe("cancelled")
    expect(f.lifecycle.pendingRevivals?.obligation(hang)).toBe("none")
  })
})
