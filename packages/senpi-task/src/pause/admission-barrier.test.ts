import { describe, expect, test } from "bun:test"
import { AdmissionBarrier } from "./admission-barrier"

const participant = { key: "task:a", runRef: { kind: "task" as const, id: "a" } }

describe("root session admission barrier", () => {
  test("#given an authorized Resume #when the same Stop is replayed #then its credential is not revoked", () => {
    const barrier = new AdmissionBarrier()
    barrier.close("root", 1)
    const credential = barrier.resume("root", 1, "resume-1")
    barrier.close("root", 1)
    expect(barrier.state("root")).toEqual({ kind: "resuming", pauseSeq: 1, resumeId: "resume-1" })
    expect(barrier.enter("root", participant, credential).kind).toBe("entered")
  })

  test("#given an entered ticket #when Stop closes #then every in-flight participant is snapshotted", () => {
    const barrier = new AdmissionBarrier()
    const entered = barrier.enter("root", participant)
    expect(entered.kind).toBe("entered")
    expect(barrier.close("root", 1)).toEqual([participant])
    if (entered.kind !== "entered") throw new Error("ticket missing")
    expect(entered.ticket.check()).toEqual({ kind: "held", pauseSeq: 1 })
    expect(entered.ticket.commit()).toEqual({
      kind: "start_paused",
      owner: { parentSessionId: "root", parentPauseSeq: 1, runRef: participant.runRef },
    })
    expect(barrier.enter("root", { ...participant, key: "b" }).kind).toBe("held")
    entered.ticket.leave()
    expect(barrier.inFlight("root")).toEqual([])
  })

  test("#given Resume 1 admitted a callback #when Stop 2 and Resume 2 replace it #then the stale credential cannot commit", () => {
    const barrier = new AdmissionBarrier()
    barrier.close("root", 1)
    const first = barrier.resume("root", 1, "resume-1")
    const entered = barrier.enter("root", participant, first)
    expect(entered.kind).toBe("entered")
    barrier.close("root", 2)
    const second = barrier.resume("root", 2, "resume-2")
    if (entered.kind !== "entered") throw new Error("ticket missing")
    expect(entered.ticket.check()).toEqual({ kind: "held", pauseSeq: 2 })
    expect(barrier.enter("root", participant, first).kind).toBe("held")
    expect(barrier.enter("root", participant).kind).toBe("held")
    expect(barrier.enter("root", participant, second).kind).toBe("entered")
    expect(barrier.release("root", first)).toBe(false)
    expect(barrier.release("root", second)).toBe(true)
    expect(barrier.enter("root", participant).kind).toBe("entered")
    expect(entered.ticket.check()).toEqual({ kind: "held", pauseSeq: 2 })
    expect(barrier.enter("root", participant, first).kind).toBe("held")
    barrier.close("root", 1)
    expect(barrier.state("root")).toEqual({ kind: "open" })
  })

  test("#given restored resuming state #when transaction is superseded #then ordinary admission stays closed", () => {
    const barrier = new AdmissionBarrier()
    barrier.restore("root", { kind: "resuming", pauseSeq: 1, resumeId: "stale" }, {
      newestSeq: 2, superseded: true,
    })
    expect(barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 2 })
    expect(barrier.enter("root", participant).kind).toBe("held")
  })

  test("#given an already superseded sequence #when an old Stop or Resume arrives #then the high water never moves backwards", () => {
    const barrier = new AdmissionBarrier()
    barrier.close("root", 2)
    barrier.close("root", 1)
    expect(barrier.state("root")).toEqual({ kind: "closed", pauseSeq: 2 })
    expect(() => barrier.resume("root", 1, "stale")).toThrow("stale")
  })
})
