import { afterEach, describe, expect, test } from "bun:test"
import { B_PID, cleanupPair, controlPair, T1 } from "./__fixtures__/control-pair"

afterEach(cleanupPair)

const RUN = { kind: "task" as const, id: T1 }
const pausedUnderA = { status: "paused" as const, run_pause: { parent_session_id: "parent-1", parent_pause_seq: 2, run_ref: RUN } }

function seedLedger(pair: ReturnType<typeof controlPair>, state: "held" | "owned_elsewhere" | "held_remote" | "lost", extra: Record<string, unknown> = {}) {
  pair.runPause.registry.begin("parent-1", 2, [{ key: T1, taskId: T1, kind: "task", runRef: RUN, runEpoch: 1, state, at: new Date(0).toISOString(), ...extra }])
  pair.runPause.registry.phase("parent-1", 2, "applied")
}

const participant = (pair: ReturnType<typeof controlPair>) => pair.runPause.registry.load("parent-1")?.participants[T1]

describe("a run's Stop and Resume carried to the live owner (#12349 part 2)", () => {
  test("#given B holds a live child #when A Stops #then B pauses it once under A's run and A's ledger reads held_remote (RED 1)", async () => {
    const pair = controlPair()
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    expect(pair.owner.calls.pause).toBe(1)
    expect(participant(pair)).toMatchObject({ state: "held_remote", remoteAckSeq: 2, ownerPid: B_PID })
    expect(pair.calls.pause).toBe(0)
  })

  test("#given a child paused under A's run held by B #when A Resumes #then B resumes it once and A never restores it (RED 2)", async () => {
    const pair = controlPair({ record: pausedUnderA })
    await pair.owner.pauseTask(T1, { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN })
    await pair.advertise()
    seedLedger(pair, "held", { ackSeq: 2, observedChildSeq: 1 })
    const result = await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(result.kind).toBe("installed")
    expect(pair.owner.calls.resume).toBe(1)
    expect(participant(pair)).toMatchObject({ state: "resumed" })
    expect(pair.calls.resumeLost).toBe(0)
  })

  test("#given an un-acked owned_elsewhere participant whose owner never answers #when A Resumes #then admission reopens and it stays remote (RED 3, 17b)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    seedLedger(pair, "owned_elsewhere")
    const result = await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(result.kind).toBe("installed")
    expect(pair.runPause.controller.released("parent-1", 2, "r-1")).toBe(true)
    expect(pair.barrier.state("parent-1")).toEqual({ kind: "open" })
    expect(participant(pair)).toMatchObject({ state: "owned_elsewhere" })
    expect(participant(pair)?.ackSeq).toBeUndefined()
    expect(pair.runPause.controller.hasRemote("parent-1")).toBe(true)
  })

  test("#given the issue's ledger (lost, 'still held by live host') #when A Resumes #then the owner resumes the child once (RED 5b)", async () => {
    const pair = controlPair({ record: pausedUnderA })
    await pair.owner.pauseTask(T1, { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN })
    await pair.advertise()
    seedLedger(pair, "lost", { lostReason: "still held by live host" })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.owner.calls.resume).toBe(1)
    expect(participant(pair)?.state).toBe("resumed")
  })

  test("#given a stopped run #when a message is sent to B's child #then it is held, and B delivers it before resuming (RED 5)", async () => {
    const pair = controlPair()
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    const record = pair.store.load(T1)
    if (record === null || record === undefined) throw new Error("record missing")
    const sent = await pair.carry.carry(record, { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN }, "please also check the tests")
    expect(sent).toMatchObject({ kind: "held", pause_seq: 2 })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.owner.calls.hold).toHaveLength(1)
    expect(pair.owner.calls.resume).toBe(1)
  })

  test("#given B's own Stop is held by another user hold #when the ack says owner_held #then A keeps the child remote, never held_by_user (19)", async () => {
    const pair = controlPair({ record: pausedUnderA })
    await pair.owner.pauseTask(T1, { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN })
    pair.owner.barrier?.close("parent-1", 9)
    await pair.advertise()
    seedLedger(pair, "held_remote", { remoteAckSeq: 2 })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(participant(pair)).toMatchObject({ state: "held_remote" })
    expect(pair.owner.calls.resume).toBe(0)
  })

  test("#given a remote participant whose owner died #when A Resumes #then the handoff restores and resumes it locally once (17e)", async () => {
    const pair = controlPair({ record: pausedUnderA })
    seedLedger(pair, "owned_elsewhere")
    pair.alive.delete(B_PID)
    const result = await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(result.kind).toBe("installed")
    expect(pair.calls.resumeLost).toBe(1)
    expect(participant(pair)?.state).toBe("resumed")
  })
})
