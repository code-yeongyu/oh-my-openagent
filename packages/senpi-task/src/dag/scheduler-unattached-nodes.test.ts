// A scheduler built over a run whose active nodes belong to children it does not hold can neither
// fold them nor admit anything. It used to throw and leave the run `running` with no scheduler,
// which every later reader saw as live work.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  LongRunningTaskManager,
  node,
  owner,
  parentSessionId,
  pausedRecord,
  runId,
  taskRecord,
} from "./__fixtures__/reattached-run"
import type { DagDefinition } from "./graph"
import { subscribeDagJournal } from "./journal"
import { createDagRecovery } from "./recovery"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import { createDagRunReservations } from "./run-reservations"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG scheduler over active nodes it does not hold", () => {
  test("#given a running run whose active node has no child attached to this scheduler #when the scheduler runs #then the run is parked as paused and recovery can finish it", async () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-unattached-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = {
      key: "unattached-nodes",
      name: "unattached nodes",
      nodes: [node("gone"), node("after", ["gone"])],
    }
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(input, {
      gone: { state: "running", taskId: "task-gone", attempt: 1 },
      after: { state: "pending" },
    })
    const initialRecord = { ...paused, status: "running" as const }
    store.writeCheckpoint(runId, initialRecord)
    manager.add(taskRecord(owner("gone"), "running", "task-gone"))

    // when
    const parked = await createDagScheduler({
      reservations: createDagRunReservations(),
      store,
      taskManager: manager,
      initialRecord,
    }).run()

    // then - the run stops claiming to run, and the node's work is not judged here
    expect(parked.status).toBe("paused")
    expect(parked.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual(["gone:running", "after:pending"])
    expect(store.readEvents(runId, 0, { limit: 500 }).events.at(-1)).toEqual(
      expect.objectContaining({ type: "dag.run.paused", reason: "unattached_nodes" }),
    )

    // and then - the parked run is one recovery claims and completes
    const resume = createDagRecovery({ store, taskManager: manager, hostPid: 101 }).resumePausedRuns(parentSessionId)
    manager.complete("task-gone")
    const [outcome] = await resume
    expect(outcome?.record?.nodes.map((entry) => `${entry.id}:${entry.state}`)).toEqual([
      "gone:completed",
      "after:completed",
    ])
  }, 30_000)

  test("#given a parked scheduler #when the run is re-entered and parks again twice #then no parked scheduler keeps refreshing on the later commits", async () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-unattached-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const manager = new LongRunningTaskManager()
    const input: DagDefinition = { key: "parked-twice", name: "parked twice", nodes: [node("gone")] }
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(input, {
      gone: { state: "running", taskId: "task-gone", attempt: 1 },
    })
    const initialRecord = { ...paused, status: "running" as const }
    store.writeCheckpoint(runId, initialRecord)
    manager.add(taskRecord(owner("gone"), "running", "task-gone"))
    const parked = [
      createDagScheduler({ reservations: createDagRunReservations(), store, taskManager: manager, initialRecord }),
    ]
    await parked[0]?.run()

    for (let round = 0; round < 2; round += 1) {
      // when - the run is taken up again (as a recovery install puts it back to running) and parks
      // again; that commit reaches every subscriber before this probe
      const seen = parked.map((scheduler) => scheduler.snapshot().checkpointSeq)
      let unsubscribe = (): void => undefined
      const committed = new Promise<void>((resolve) => {
        unsubscribe = subscribeDagJournal(store, runId, (event) => {
          if (event.type === "dag.run.paused") resolve()
        })
      })
      const current = store.readCheckpoint<typeof initialRecord>(runId)
      if (current === null) throw new Error("expected a checkpoint")
      const taken = { ...current, status: "running" as const }
      store.writeCheckpoint(runId, taken)
      const next = createDagScheduler({
        reservations: createDagRunReservations(),
        store,
        taskManager: manager,
        initialRecord: taken,
      })
      await next.run()
      await committed
      unsubscribe()

      // then
      expect(next.snapshot().status).toBe("paused")
      expect(parked.map((scheduler) => scheduler.snapshot().checkpointSeq)).toEqual(seen)
      parked.push(next)
    }
  })
})
