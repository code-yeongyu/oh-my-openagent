// A user Stop journals `user_stop` on every live run of the session, and that pause drops the run's
// lease. Over a run another live process is scheduling, it would strip that process's lease while its
// scheduler keeps running, and the run could then be claimed twice. Stop decides per run on the fresh
// record under the run lock with the one holder rule (#15125).
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDagFileStore, type DagRunId, type DagRunRecordV1 } from "@oh-my-opencode/senpi-task/dag"

import { LongRunningTaskManager, node, pausedRecord } from "../../../../senpi-task/src/dag/__fixtures__/reattached-run"
import { createDagRecovery } from "../../../../senpi-task/src/dag/recovery"
import { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { createDagRunPauseSource } from "./dag-run-pause-source"
import { FOREIGN_HOST_PID } from "./dag-runtime-recovery.test-support"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number; readonly previousLeaseHolderPid?: number }

function session(holder: { alive: boolean }) {
  const directory = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-stop-holder-"))
  cleanupRoots.push(directory)
  const store = createDagFileStore({ project_dir: directory })
  const taskManager = new LongRunningTaskManager()
  const isProcessAlive = (pid: number): boolean => pid === FOREIGN_HOST_PID && holder.alive
  const runs: DagRunRecordV1[] = []
  const add = (id: string, shape: Partial<Leased>): DagRunId => {
    const { previousLeaseHolderPid: _previous, ...base } = pausedRecord(
      { key: id, name: id, nodes: [node("only")] },
      { only: { state: "pending" } },
    )
    const record = { ...base, runId: id as DagRunId, runKey: id, ...shape } as Leased
    store.writeCheckpoint(record.runId, record)
    runs.push(record)
    return record.runId
  }
  const warnings: Array<{ readonly message: string; readonly fields?: Record<string, unknown> }> = []
  const recovery = createDagRecovery({ store, taskManager, isProcessAlive })
  const source = createDagRunPauseSource({
    barrier: new AdmissionBarrier(),
    records: () => runs.map((record) => store.readCheckpoint<DagRunRecordV1>(record.runId) ?? record),
    options: (record) => ({ store, taskManager, isProcessAlive, initialRecord: record }),
    retire: async () => undefined,
    prepareResume: () => undefined,
    recovery,
    adopt: () => undefined,
    cancel: async () => undefined,
    warn: (message, fields) => warnings.push({ message, ...(fields === undefined ? {} : { fields }) }),
  })
  const bytes = (runId: DagRunId): string => fs.readFileSync(store.paths.run(runId), "utf8")
  const read = (runId: DagRunId) => store.readCheckpoint<Leased>(runId)
  const events = (runId: DagRunId) => store.readEvents(runId, 0, { limit: 500 }).events
  return { store, recovery, source, add, bytes, read, events, warnings }
}

describe("DAG user Stop under the one holder rule", () => {
  test("#given a run another live process is scheduling beside a run of this host #when the user stops the session #then only this host's run is paused and the foreign run is left untouched", async () => {
    // given
    const s = session({ alive: true })
    const foreign = s.add("run-foreign", { status: "running", leaseHolderPid: FOREIGN_HOST_PID })
    const own = s.add("run-own", { status: "running", leaseHolderPid: process.pid })
    const foreignBefore = s.bytes(foreign)

    // when
    await s.source.quiesce?.("session-parent", 3)

    // then
    expect(s.bytes(foreign)).toBe(foreignBefore)
    expect(s.events(foreign)).toEqual([])
    expect(s.read(foreign)?.leaseHolderPid).toBe(FOREIGN_HOST_PID)
    expect(s.read(own)).toEqual(
      expect.objectContaining({ status: "paused", pause: { reason: "user_stop", pauseSeq: 3 } }),
    )
    expect(s.warnings).toEqual([
      expect.objectContaining({ fields: expect.objectContaining({ runId: foreign, holderPid: FOREIGN_HOST_PID }) }),
    ])
  })

  test("#given a run a still-draining host paused for shutdown #when the user stops the session #then it is stopped, keeps its previous holder, is not auto-resumed, and resumes by the user once that host is gone", async () => {
    // given
    const holder = { alive: true }
    const s = session(holder)
    const drained = s.add("run-drained", { status: "paused", previousLeaseHolderPid: FOREIGN_HOST_PID })

    // when
    await s.source.quiesce?.("session-parent", 4)

    // then
    expect(s.read(drained)).toEqual(
      expect.objectContaining({
        status: "paused",
        pause: { reason: "user_stop", pauseSeq: 4 },
        previousLeaseHolderPid: FOREIGN_HOST_PID,
      }),
    )
    expect(await s.recovery.installPausedRuns("session-parent", () => undefined)).toEqual([])
    expect(await s.recovery.installResumedRun(drained, "session-parent", 4)).toEqual(
      expect.objectContaining({ kind: "skipped", reason: "live_lease", holderPid: FOREIGN_HOST_PID }),
    )

    // and once that host is gone, the user's Resume claims it
    holder.alive = false
    const resumed = await s.recovery.installResumedRun(drained, "session-parent", 4)
    expect(resumed.kind).toBe("installed")
    if (resumed.kind === "installed") {
      resumed.release()
      await resumed.settled
    }
  })
})
