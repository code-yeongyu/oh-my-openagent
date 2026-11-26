// A retry chooses its targets, then acquires the run. Another process can finish a retry of the same
// node in between; the run it acquires is then settled with that node completed, and a retry that
// still used its earlier choice would journal `retried` for completed work. Every decision the retry
// takes belongs on the record it acquired (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LongRunningTaskManager, node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import type { DagRunRecordV1 } from "./manager"
import { retryDagNodes } from "./node-retry"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId } from "./types"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG retry decided on the acquired record", () => {
  test("#given a failed node #when another process completes it between the retry's read and its acquisition #then the retry is refused and nothing is journaled", () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retry-acquired-"))
    cleanupRoots.push(directory)
    const base = createDagFileStore(ownedTaskState(directory))
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "retry-acquired", name: "retry acquired", nodes: [node("broken")] },
      { broken: { state: "failed" } },
    )
    const failed: DagRunRecordV1 = { ...paused, status: "failed" }
    base.writeCheckpoint(runId, failed)
    let raced = false
    const store: DagFileStore = {
      ...base,
      withRunLock: (lockedRunId, operation) => {
        if (!raced && lockedRunId === runId) {
          raced = true
          const record = base.readCheckpoint<DagRunRecordV1>(runId)
          if (record !== null) {
            const nodes = record.nodes.map((entry) => ({ ...entry, state: "completed" as const }))
            base.writeCheckpoint(runId, { ...record, nodes, status: "completed" })
          }
        }
        return base.withRunLock(lockedRunId, operation)
      },
    }

    // when
    let refusal: unknown
    try {
      retryDagNodes({ store, taskManager: new LongRunningTaskManager(), initialRecord: failed }, runId, [
        "broken" as DagNodeId,
      ])
    } catch (error) {
      refusal = error
    }

    // then
    expect(raced).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "node_not_retryable" }))
    expect(base.readEvents(runId, 0, { limit: 500 }).events).toEqual([])
    expect(base.readCheckpoint<{ readonly leaseHolderPid?: number }>(runId)?.leaseHolderPid).toBeUndefined()
  })

  test("#given a user-stopped run #when it is resumed between a staged retry's read and its write #then nothing is staged and the retry is refused", () => {
    // given
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retry-staged-race-"))
    cleanupRoots.push(directory)
    const base = createDagFileStore(ownedTaskState(directory))
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "retry-staged-race", name: "retry staged race", nodes: [node("broken")] },
      { broken: { state: "failed" } },
    )
    const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
    base.writeCheckpoint(runId, stopped)
    let raced = false
    const store: DagFileStore = {
      ...base,
      withRunLock: (lockedRunId, operation) => {
        if (!raced && lockedRunId === runId) {
          raced = true
          const { pause: _pause, ...resumed } = stopped
          base.writeCheckpoint(runId, { ...resumed, status: "running" })
        }
        return base.withRunLock(lockedRunId, operation)
      },
    }

    // when
    let refusal: unknown
    try {
      retryDagNodes({ store, taskManager: new LongRunningTaskManager(), initialRecord: stopped }, runId, [
        "broken" as DagNodeId,
      ])
    } catch (error) {
      refusal = error
    }

    // then
    expect(raced).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_user_paused" }))
    expect(base.readEvents(runId, 0, { limit: 500 }).events).toEqual([])
  })
})
