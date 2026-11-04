import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { seedRecord } from "../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { controlDir, registerName } from "../../../../senpi-task/src/control/control-paths"
import { runTaskOutput } from "../../../../senpi-task/src/tools/output/output"
import type { PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { REMOTE_DEADLINE_MS } from "../../../../senpi-task/src/pause/remote-participants"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import { B_PID, cleanupPair, controlPair, T1 } from "./__fixtures__/control-pair"

afterEach(cleanupPair)

type Pair = ReturnType<typeof controlPair>
const RUN = { kind: "task" as const, id: T1 }
const OWNER = { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN }
const pausedUnderA = { status: "paused" as const, run_pause: { parent_session_id: "parent-1", parent_pause_seq: 2, run_ref: RUN } }

function seed(pair: Pair, state: PauseParticipant["state"], extra: Partial<PauseParticipant> = {}, key = T1): void {
  pair.runPause.registry.begin("parent-1", 2, [{ key, taskId: key, kind: "task", runRef: { kind: "task", id: key }, runEpoch: 1, state, at: new Date(0).toISOString(), ...extra }])
  pair.runPause.registry.phase("parent-1", 2, "applied")
}
const participant = (pair: Pair, key = T1) => pair.runPause.registry.load("parent-1")?.participants[key]
const record = (pair: Pair): TaskRecord => {
  const loaded = pair.store.load(T1)
  if (loaded === null || loaded === undefined) throw new Error(`${T1} has no record`)
  return loaded
}

describe("#12349 part 2 requester cases (design section 7)", () => {
  test("#given B Stopped its own children at S' before the reload #when A Resumes at S #then B's barrier opens and the child resumes once (test 4, F12)", async () => {
    const pair = controlPair()
    await pair.owner.pauseTask(T1, OWNER)
    pair.owner.barrier?.close("parent-1", 2)
    await pair.advertise()
    seed(pair, "held_remote", { remoteAckSeq: 2 })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.owner.barrier?.state("parent-1")).toEqual({ kind: "open" })
    expect(pair.owner.calls.resume).toBe(1)
    expect(participant(pair)?.state).toBe("resumed")
  })

  test("#given Stop, a message and Resume all land before B's first tick #when B ticks #then pause, hold, resume once (test 6)", async () => {
    const pair = controlPair()
    await pair.advertise()
    pair.ownerTicks.enabled = false
    await pair.runPause.controller.pause("parent-1", 2)
    expect(participant(pair)?.state).toBe("owned_elsewhere")
    await pair.carry.carry(record(pair), OWNER, "late guidance")
    pair.ownerTicks.enabled = true
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.owner.calls).toMatchObject({ pause: 1, resume: 1 })
    expect(pair.owner.calls.hold).toHaveLength(1)
  })

  test("#given B acks only after the Stop's window #when A's watcher ticks #then the participant moves to held_remote with no user action (test 9)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    expect(participant(pair)?.state).toBe("owned_elsewhere")
    await pair.inbox.tick()
    await pair.runPause.bridge.tickRemote("parent-1")
    expect(participant(pair)).toMatchObject({ state: "held_remote", remoteAckSeq: 2 })
  })

  test("#given the Stop never listed the child #when a message is sent to it #then it joins the run and the Resume reaches it once (test 11c)", async () => {
    const pair = controlPair()
    await pair.advertise()
    pair.runPause.registry.begin("parent-1", 2, [])
    pair.runPause.registry.phase("parent-1", 2, "applied")
    expect(await pair.carry.carry(record(pair), OWNER, "hello")).toMatchObject({ kind: "held" })
    expect(participant(pair)).toMatchObject({ state: "owned_elsewhere" })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(participant(pair)?.state).toBe("resumed")
    expect(pair.owner.calls.resume).toBe(1)
  })

  test("#given the owner already resumed and a register with guidance arrives #when answered #then each entry is undelivered and removed, no second resume (test 11d requester half)", async () => {
    const pair = controlPair({ record: { run_pause_resumed: { resume_id: "r-1", parent_session_id: "parent-1", parent_pause_seq: 2 } } })
    await pair.advertise()
    seed(pair, "held_remote", { remoteAckSeq: 2, guidance: [{ inputId: "send-1", revision: 0, text: "late" }] })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.owner.calls.resume).toBe(0)
    expect(pair.owner.calls.hold).toHaveLength(0)
    expect(participant(pair)?.guidance).toBeUndefined()
  })

  test("#given the owner died before reading the Stop #when A's watcher ticks #then A pauses the child locally (test 17, F2)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    pair.alive.delete(B_PID)
    await pair.runPause.bridge.tickRemote("parent-1")
    expect(pair.calls.pause).toBe(1)
    expect(participant(pair)?.state).toBe("held")
  })

  test("#given the owner died after resuming but before acking #when A Resumes #then nothing resumes twice (test 17, F3)", async () => {
    const pair = controlPair({ record: { run_pause_resumed: { resume_id: "r-1", parent_session_id: "parent-1", parent_pause_seq: 2 } } })
    seed(pair, "held_remote", { remoteAckSeq: 2 })
    pair.alive.delete(B_PID)
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.calls.resumeLost).toBe(0)
    expect(participant(pair)).toBeUndefined()
  })

  test("#given the child engine has no native pause #when A Stops #then it stays remote, never lost (test 17c)", async () => {
    const pair = controlPair()
    pair.owner.pauseError = Object.assign(new Error("no native pause"), { code: "native_pause_unavailable" })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    expect(participant(pair)?.state).toBe("owned_elsewhere")
  })

  test("#given the owner filed the child lost in the shared ledger #when A's released Resume retries #then the owner resumes it once, never ended (test 17d)", async () => {
    const pair = controlPair({ record: pausedUnderA })
    await pair.owner.pauseTask(T1, OWNER)
    await pair.advertise()
    seed(pair, "lost", { lostReason: "resume failed: stale" })
    pair.runPause.registry.phase("parent-1", 2, "resumed")
    pair.barrier.release("parent-1", pair.barrier.resume("parent-1", 2, "r-0"))
    await pair.runPause.controller.retryLost("parent-1", 2)
    expect(pair.owner.calls.resume).toBe(1)
    expect(await pair.runPause.controller.endLost("parent-1", 2)).toEqual([])
    expect(pair.calls.endLost).toBe(0)
  })

  test("#given two lost remote children whose owner never answers #when the released Resume retries #then the pass waits one window, not one per child (review of #12373, LOW)", async () => {
    const pair = controlPair({ ownerTicks: false })
    const T2 = "st_00000002"
    seedRecord(pair.store, { task_id: T2, status: "running", run_epoch: 1, host_pid: B_PID })
    await pair.advertise()
    const lost = (key: string): PauseParticipant => ({ key, taskId: key, kind: "task", runRef: { kind: "task", id: key }, runEpoch: 1,
      state: "lost", lostReason: "resume failed: stale", at: new Date(0).toISOString() })
    pair.runPause.registry.begin("parent-1", 2, [lost(T1), lost(T2)])
    pair.runPause.registry.phase("parent-1", 2, "resumed")
    pair.barrier.release("parent-1", pair.barrier.resume("parent-1", 2, "r-0"))
    const startedAt = pair.clock()
    await pair.runPause.controller.retryLost("parent-1", 2)
    expect(pair.clock() - startedAt).toBeLessThan(2 * REMOTE_DEADLINE_MS)
  })

  test("#given B's own held participant with a local cutoff becomes remote #when A Resumes #then ackSeq and observedChildSeq are kept (test 17f)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    seed(pair, "held", { ackSeq: 2, observedChildSeq: 5 })
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(participant(pair)).toMatchObject({ state: "owned_elsewhere", ackSeq: 2, observedChildSeq: 5 })
  })

  test("#given a child paused at S-1 under the run and a dead owner #when A Resumes at S #then the record is aligned to S before the resume (test 17g, F7)", async () => {
    const pair = controlPair({ record: { ...pausedUnderA, run_pause: { ...pausedUnderA.run_pause, parent_pause_seq: 1 } } })
    seed(pair, "owned_elsewhere")
    pair.alive.delete(B_PID)
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(record(pair).run_pause?.parent_pause_seq).toBe(2)
    expect(pair.calls.resumeLost).toBe(1)
  })

  test("#given guidance carried and the owner dead before its tick #when A Resumes #then the entry reaches the restored child once (test 17i)", async () => {
    const pair = controlPair({ ownerTicks: false, record: pausedUnderA })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    await pair.carry.carry(record(pair), OWNER, "carry me")
    pair.alive.delete(B_PID)
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.calls.hold).toBe(1)
    expect(pair.calls.resumeLost).toBe(1)
  })

  test("#given the register was deleted after a send #when the watcher ticks #then it is rewritten with the entry from the ledger (test 17i, r6-4)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    await pair.runPause.controller.pause("parent-1", 2)
    await pair.carry.carry(record(pair), OWNER, "keep me")
    const path = join(controlDir(pair.store.stateDir), registerName(T1, "parent-1"))
    rmSync(path)
    await pair.runPause.bridge.tickRemote("parent-1")
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf8")).toContain("keep me")
  })

  test("#given a watcher tick arriving while the user's Resume is in flight #when both run #then the tick waits behind the Resume (test 17j, r6-3)", async () => {
    const pair = controlPair({ ownerTicks: false, record: pausedUnderA })
    await pair.advertise()
    seed(pair, "held_remote", { remoteAckSeq: 2 })
    const order: string[] = []
    const resumed = pair.runPause.bridge.changed("parent-1", { change: "resumed", pauseSeq: 2, holds: [] }).then(() => { order.push("resume") })
    const ticked = pair.runPause.bridge.tickRemote("parent-1").then(() => { order.push("tick") })
    await Promise.all([resumed, ticked])
    expect(order).toEqual(["resume", "tick"])
    expect(pair.runPause.registry.load("parent-1")?.phase).toBe("resumed")
  })

  test("#given four un-acked remote children #when A Resumes #then the barrier leaves resuming within ONE 3 s deadline (test 20b)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    const keys = ["st_00000002", "st_00000003", "st_00000004"]
    for (const key of keys) {
      seedRecord(pair.store, { task_id: key, status: "running", run_epoch: 1, host_pid: B_PID })
      pair.owner.live.add(key)
    }
    await pair.advertise()
    pair.runPause.registry.begin("parent-1", 2, [T1, ...keys].map(key => ({ key, taskId: key, kind: "task" as const,
      runRef: { kind: "task" as const, id: key }, runEpoch: 1, state: "owned_elsewhere" as const, at: new Date(0).toISOString() })))
    pair.runPause.registry.phase("parent-1", 2, "applied")
    const started = pair.clock()
    await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(pair.clock() - started).toBeLessThanOrEqual(3_500)
  })

  test("#given a child another live process runs #when task_output reads it #then the status line says where it runs, or why it cannot be reached", async () => {
    const pair = controlPair()
    const deps = { stateDir: pair.store.stateDir, ownerStatus: (entry: TaskRecord) => pair.channel.ownerStatus(entry),
      manager: { list: () => [{ record: record(pair) }] } } as unknown as Parameters<typeof runTaskOutput>[0]
    const unreachable = await runTaskOutput(deps, { task_id: T1 }, "parent-1")
    expect(unreachable.details).toMatchObject({ snapshot: { owner: `owner cannot apply: owner_unsupported (pid ${B_PID})` } })
    await pair.advertise()
    const carried = await runTaskOutput(deps, { task_id: T1 }, "parent-1")
    expect(carried.details).toMatchObject({ snapshot: { owner: expect.stringContaining(`running in another omo process (pid ${B_PID})`) } })
  })
})
