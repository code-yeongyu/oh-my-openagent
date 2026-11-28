// A retry on a user-stopped run only stages the nodes for the user's Resume: it starts no run. The
// scheduler it returns to fill its result shape must therefore stop listening for journal commits at
// once, or every staged retry leaves a context refreshing on each later commit (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import { createDagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import { retryDagNodes } from "./node-retry"
import { createDagRunReservations } from "./run-reservations"
import { applyDagSchedulerEvent, type DagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG retry staged on a user-stopped run", () => {
  test("#given a user-stopped run #when retries are staged again and again #then no staged scheduler refreshes on a later commit", async () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retry-staged-"))
    cleanupRoots.push(directory)
    const store = createDagFileStore(ownedTaskState(directory))
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "staged", name: "staged", nodes: [node("broken")] },
      { broken: { state: "failed" } },
    )
    const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 1 } }
    store.writeCheckpoint(runId, stopped)
    const options = {
      store,
      taskManager: new LongRunningTaskManager(),
      initialRecord: stopped,
      reservations: createDagRunReservations(),
    }

    // when
    const staged: DagScheduler[] = []
    for (let round = 0; round < 3; round += 1) {
      staged.push(retryDagNodes(options, runId, ["broken" as DagNodeId]).scheduler)
    }
    const seen = staged.map((scheduler) => scheduler.snapshot().checkpointSeq)
    createDagJournal<DagRunRecordV1>({
      store,
      runId,
      initialCheckpoint: stopped,
      applyEvent: (record, event) => applyDagSchedulerEvent(record, event),
    }).append({ type: "dag.wave.started", waveIndex: 0, nodeIds: [] })
    await Promise.resolve()

    // then
    expect(staged.map((scheduler) => scheduler.snapshot().checkpointSeq)).toEqual(seen)
  })
})
