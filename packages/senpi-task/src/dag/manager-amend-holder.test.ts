// An amendment of a user-stopped run is a write to that run like any other stopped-run write: it lands
// only while no other live process holds the run. A successor claiming the run for its Resume writes
// its lease while the record still reads the same Stop (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { node, pausedRecord, runId } from "./__fixtures__/reattached-run"
import { createDagManager, type DagRunRecordV1 } from "./manager"
import { createDagFileStore, type DagFileStore } from "./store"
import { ownedTaskState } from "../store/__fixtures__/owned-task-state"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DAG amendment of a user-stopped run under the holder rule", () => {
  test("#given a user-stopped run #when a live process claims it inside the amendment's write lock #then the amendment is refused run_not_owned and the definition is unchanged", async () => {
    // given - the live foreign holder is this test's own parent process
    const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-amend-holder-"))
    cleanupRoots.push(directory)
    const base = createDagFileStore(ownedTaskState(directory))
    const { previousLeaseHolderPid: _previous, ...paused } = pausedRecord(
      { key: "amend-holder", name: "amend holder", nodes: [node("open")] },
      { open: { state: "pending" } },
    )
    const stopped: DagRunRecordV1 = { ...paused, pause: { reason: "user_stop", pauseSeq: 2 } }
    base.writeCheckpoint(runId, stopped)
    let raced = false
    const store: DagFileStore = {
      ...base,
      withRunLock: (lockedRunId, operation) => {
        if (!raced && lockedRunId === runId) {
          raced = true
          base.writeCheckpoint(runId, { ...stopped, leaseHolderPid: process.ppid } as DagRunRecordV1)
        }
        return base.withRunLock(lockedRunId, operation)
      },
    }
    const definition = { key: "amend-holder", name: "amend holder", nodes: [{ ...node("open"), prompt: "changed" }] }

    // when
    const refusal = await createDagManager({ store })
      .amend({ runId, definition, parentSessionId: stopped.parentSessionId })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    // then
    expect(raced).toBe(true)
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(base.readCheckpoint<DagRunRecordV1>(runId)?.definitionFingerprint).toBe(stopped.definitionFingerprint)
  })
})
