// A send is decided once, on one fresh record under one run lock, into guidance, steer, revive or a
// typed refusal; only steer and revive reach the child (#15125). The early read is a fast path that
// may refuse, never a reason to allow.
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"

import { LIVE_THIRD_HOST, sendRun, THIS_HOST, type Leased } from "./__fixtures__/send-run"
import { runId } from "./__fixtures__/reattached-run"
import type { DagFileStore } from "./store"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

type Change = (record: Leased) => Leased

/** Rewrites the run when the send first takes its run lock (`after`: right after that lock instead). */
const flipAtLock =
  (change: Change, after = false) =>
  (base: DagFileStore): DagFileStore => {
    let flipped = false
    const flip = () => {
      if (flipped) return
      flipped = true
      const record = base.readCheckpoint<Leased>(runId)
      if (record !== null) base.writeCheckpoint(runId, change(record))
    }
    return {
      ...base,
      withRunLock: (lockedRunId, operation) => {
        if (lockedRunId !== runId) return base.withRunLock(lockedRunId, operation)
        if (!after) flip()
        const result = base.withRunLock(lockedRunId, operation)
        // A well-behaved process takes the run only while no live holder names it.
        if (after && base.readCheckpoint<Leased>(runId)?.leaseHolderPid !== THIS_HOST) flip()
        return result
      },
    }
  }

const takenByLiveHost: Change = (record) => ({ ...record, status: "running", leaseHolderPid: LIVE_THIRD_HOST })

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

describe("DAG send decided on one fresh record under one run lock", () => {
  test("#given a failed run #when a live process takes it, running, before the send's decision #then run_not_owned and the child is never touched", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a"], { wrap: flipAtLock(takenByLiveHost) })

    // when
    const refusal = await refusalOf(run.send("a"))

    // then
    expect(refusal).toEqual(expect.objectContaining({ code: "run_not_owned" }))
    expect(run.sends).toEqual([])
    expect(run.events()).toEqual([])
    expect(run.read()?.leaseHolderPid).toBe(LIVE_THIRD_HOST)
  })

  test("#given a failed run #when a live process that respects the holder rule takes it as soon as the run is free #then the child is touched only under this host's lease", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a"], { wrap: flipAtLock(takenByLiveHost, true) })

    // when
    const outcome = await refusalOf(run.send("a"))

    // then - either the send won the run (lease ours at the child) or it never touched the child
    if (run.sends.length > 0) expect(run.leaseAtSend).toEqual([THIS_HOST])
    else expect(outcome).toEqual(expect.objectContaining({ code: "run_not_owned" }))
  })

  test("#given a failed run #when the user stops it before the send's decision #then the message becomes guidance and the child is never touched", async () => {
    // given
    const stopped: Change = (record) => ({ ...record, status: "paused", pause: { reason: "user_stop", pauseSeq: 3 } })
    const run = sendRun(cleanupRoots, ["a"], { wrap: flipAtLock(stopped) })

    // when
    const result = await run.send("a")

    // then
    expect(result.delivery).toBe("guidance")
    expect(run.sends).toEqual([])
    expect(run.events().map((event) => event.type)).toEqual(["dag.guidance.added"])
  })

  for (const [landed, change, code] of [
    [
      "another session's record",
      ((record) => ({ ...record, parentSessionId: "session-other" })) as Change,
      "run_not_owned",
    ],
    ["completed", ((record) => ({ ...record, status: "completed" })) as Change, "node_not_continuable"],
    ["cancelled", ((record) => ({ ...record, status: "cancelled" })) as Change, "node_not_continuable"],
  ] as const) {
    test(`#given a failed run #when it becomes ${landed} before the send's decision #then the typed refusal and the child is never touched`, async () => {
      // given
      const run = sendRun(cleanupRoots, ["a"], { wrap: flipAtLock(change) })

      // when
      const refusal = await refusalOf(run.send("a"))

      // then
      expect(refusal).toEqual(expect.objectContaining({ code }))
      expect(run.sends).toEqual([])
      expect(run.events()).toEqual([])
    })
  }

  test("#given a running run this host holds #when it settles failed before the send's decision #then the send revives with the lease on the record before the child is touched", async () => {
    // given
    const run = sendRun(cleanupRoots, ["a"], {
      record: (failed) => ({ ...failed, status: "running", leaseHolderPid: THIS_HOST }),
      wrap: flipAtLock((record) => ({ ...record, status: "failed" })),
    })

    // when
    const result = await run.send("a")

    // then
    expect(result.delivery).toBe("revive")
    expect(run.leaseAtSend).toEqual([THIS_HOST])
    run.manager.complete("task-a")
    await result.settled
  })

  test("#given a steer into a parked run #when a live process claims the run while the message is being delivered #then the steer is not recorded on the run it now holds", async () => {
    // given - a running run no scheduler holds, its node's child running
    const run: ReturnType<typeof sendRun> = sendRun(cleanupRoots, ["a"], {
      record: (failed) => ({
        ...failed,
        status: "running",
        nodes: failed.nodes.map((entry) => ({ ...entry, state: "running" as const })),
      }),
      answer: () => {
        const record = run.read()
        if (record) run.base.writeCheckpoint(runId, { ...record, leaseHolderPid: LIVE_THIRD_HOST })
        return "steered"
      },
    })

    // when
    const result = await run.send("a")

    // then
    expect(result.delivery).toBe("steer")
    expect(run.events()).toEqual([])
    expect(run.read()?.leaseHolderPid).toBe(LIVE_THIRD_HOST)
  })
})
