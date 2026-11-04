import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { registerName } from "../../../../senpi-task/src/control/control-paths"
import { readRegister } from "../../../../senpi-task/src/control/control-store"
import { taskEventLogPath } from "../../../../senpi-task/src/store/event-log"
import { parseTaskId } from "../../../../senpi-task/src/state"
import { B_PID, cleanupPair, controlPair, T1 } from "./__fixtures__/control-pair"
import { createRemoteCancel } from "./engine-remote-cancel"

afterEach(cleanupPair)

const RUN = { kind: "task" as const, id: T1 }
function loaded(pair: ReturnType<typeof controlPair>) {
  const record = pair.store.load(T1)
  if (record === null || record === undefined) throw new Error(`${T1} has no record`)
  return record
}
const events = (pair: ReturnType<typeof controlPair>): string => {
  try { return readFileSync(taskEventLogPath(pair.store.stateDir, parseTaskId(T1)), "utf8") } catch { return "" }
}

describe("cancel of a child another live process owns (design 3.7)", () => {
  test("#given an advertising owner #when A cancels #then cancel_pending, one flag + one event, and the owner cancels once (RED 8)", async () => {
    const pair = controlPair()
    await pair.advertise()
    const outcome = await pair.remoteCancel.cancel(loaded(pair), "user stop")
    expect(outcome).toMatchObject({ kind: "cancel_pending", task_id: T1, previous_status: "running" })
    expect(pair.store.load(T1)?.cancel_requested).toMatchObject({ reason: "user stop" })
    expect(events(pair).split("\n").filter(line => line.includes("cancel_requested"))).toHaveLength(1)
    await pair.inbox.tick()
    expect(pair.owner.calls.cancel).toHaveLength(1)
    expect(pair.store.load(T1)?.status).toBe("cancelled")
    expect(pair.calls.finish).toBe(0)
  })

  test("#given an owner with no live advertisement #when A cancels #then owner_cannot_apply/owner_unsupported and the record is untouched (RED 8, 16)", async () => {
    const pair = controlPair({ advertise: false })
    const before = JSON.stringify(pair.store.load(T1))
    const outcome = await pair.remoteCancel.cancel(loaded(pair), "user stop")
    expect(outcome).toEqual({ kind: "owner_cannot_apply", task_id: T1, owner_pid: B_PID, reason: "owner_unsupported" })
    expect(JSON.stringify(pair.store.load(T1))).toBe(before)
    expect(events(pair)).not.toContain("cancel_requested")
  })

  test("#given the switch off #when A cancels #then owner_cannot_apply/channel_disabled (16)", async () => {
    const pair = controlPair({ channel: false })
    await pair.advertise()
    expect(await pair.remoteCancel.cancel(loaded(pair), undefined)).toMatchObject({ kind: "owner_cannot_apply", reason: "channel_disabled" })
  })

  test("#given a carried cancel #when the owner dies before its tick #then A's cancel watcher finishes it once (17h)", async () => {
    const pair = controlPair({ ownerTicks: false })
    await pair.advertise()
    await pair.remoteCancel.cancel(loaded(pair), "user stop")
    pair.alive.delete(B_PID)
    await pair.remoteCancel.tick()
    expect(pair.calls.finish).toBe(1)
    expect(pair.store.load(T1)?.status).toBe("cancelled")
    expect(pair.owner.calls.resume).toBe(0)
  })

  test("#given a flagged record and a restarted requester with no watcher #when re-armed #then a dead owner's record is finished in one tick (20k)", async () => {
    const pair = controlPair({ record: { cancel_requested: { requested_at: new Date(0).toISOString() } } })
    pair.alive.delete(B_PID)
    pair.remoteCancel.rearm([loaded(pair)])
    await pair.remoteCancel.tick()
    expect(pair.calls.finish).toBe(1)
  })

  test("#given a flagged record whose owner cleared host_pid #when re-armed #then it is finished in one tick (20k, r13-1)", async () => {
    const pair = controlPair({ record: { status: "paused", cancel_requested: { requested_at: new Date(0).toISOString() } } })
    pair.store.mutate(T1, ({ host_pid: _gone, ...fresh }) => fresh)
    pair.remoteCancel.rearm([loaded(pair)])
    await pair.remoteCancel.tick()
    expect(pair.calls.finish).toBe(1)
  })

  test("#given an owner that no longer holds the child #when A cancels twice #then the repeat answers owner_cannot_apply/handle_gone (20d)", async () => {
    const pair = controlPair()
    await pair.advertise()
    pair.owner.live.delete(T1)
    pair.owner.live.add("st_other")
    await pair.remoteCancel.cancel(loaded(pair), undefined)
    await pair.inbox.tick()
    expect(await pair.remoteCancel.cancel(loaded(pair), undefined)).toMatchObject({ kind: "owner_cannot_apply", reason: "handle_gone" })
  })
})

describe("a cancel this process finishes itself (review of #12373)", () => {
  const flagged = { cancel_requested: { requested_at: new Date(0).toISOString() } }
  const ownedHere = (pair: ReturnType<typeof controlPair>) => pair.store.mutate(T1, ({ host_pid: _gone, ...fresh }) => fresh)
  const localCancel = (pair: ReturnType<typeof controlPair>, holds = false) => createRemoteCancel({ channel: pair.channel, store: pair.store,
    holds: () => holds, pauseSeq: () => 0, finish: async () => undefined })

  test("#given a daemon-hosted child whose cancel is already pending here #when cancelled again #then the carry declines so the omo#11765 join answers (MEDIUM)", async () => {
    const pair = controlPair({ record: { ...flagged, runner_kind: "host-session",
      host_session: { socket: "rpc.sock", routing_id: "routing-1", session_path: "session-1", instance_id: "instance-1" } } })
    ownedHere(pair)
    expect(await pair.remoteCancel.cancel(loaded(pair), "again")).toBeUndefined()
    expect(pair.calls.finish).toBe(0)
  })

  test("#given a pending cancel whose finish could not end the child #when cancelled again #then cancel_pending, never cancelled (MEDIUM)", async () => {
    const pair = controlPair({ record: flagged })
    ownedHere(pair)
    expect(await localCancel(pair).cancel(loaded(pair), "again")).toMatchObject({ kind: "cancel_pending", task_id: T1 })
    expect(pair.store.load(T1)?.status).toBe("running")
  })

  test("#given a carried cancel #when its register is read #then the requester is the channel's own pid and manager (LOW)", async () => {
    const pair = controlPair()
    await pair.advertise()
    await pair.remoteCancel.cancel(loaded(pair), "user stop")
    const read = readRegister(pair.channel.control, registerName(T1, loaded(pair).parent_session_id))
    expect(read.kind === "ok" ? read.register.requester : undefined).toEqual(pair.channel.requester)
    expect(pair.channel.requester.managerInstance).toBe("requester-a")
  })

  test("#given a watched cancel this manager holds the handle for #when the watcher ticks #then the task leaves the watch set (LOW)", async () => {
    const pair = controlPair({ record: flagged })
    ownedHere(pair)
    const cancel = localCancel(pair, true)
    cancel.arm(T1)
    await cancel.tick()
    expect(cancel.watching()).toEqual([])
  })
})

describe("compatibility edges on the Resume and held-send surfaces (design 3.3)", () => {
  test("#given no live advertisement #when A Resumes #then the failure reads owner_cannot_apply: owner_unsupported (pid N) (16)", async () => {
    const pair = controlPair({ advertise: false })
    pair.runPause.registry.begin("parent-1", 2, [{ key: T1, taskId: T1, kind: "task", runRef: RUN, runEpoch: 1, state: "owned_elsewhere", at: new Date(0).toISOString() }])
    const result = await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(result.failures).toEqual([{ key: T1, reason: `owner_cannot_apply: owner_unsupported (pid ${B_PID})` }])
    expect(pair.runPause.registry.load("parent-1")?.participants[T1]).toMatchObject({ state: "owned_elsewhere", reason: "owner_unsupported" })
  })

  test("#given the switch off and a seeded held_remote with no local cutoff #when A Resumes #then admission reopens with no throw (24)", async () => {
    const pair = controlPair({ channel: false })
    pair.runPause.registry.begin("parent-1", 2, [{ key: T1, taskId: T1, kind: "task", runRef: RUN, runEpoch: 1, state: "held_remote", remoteAckSeq: 2, at: new Date(0).toISOString() }])
    const result = await pair.runPause.controller.resume("parent-1", 2, "r-1")
    expect(result.kind).toBe("installed")
    expect(pair.runPause.controller.released("parent-1", 2, "r-1")).toBe(true)
    expect(pair.runPause.registry.load("parent-1")?.participants[T1]).toMatchObject({ state: "held_remote", reason: "channel_disabled" })
  })

  test("#given a paused remote record and no advertisement #when a message is sent #then a typed not_continuable, nothing restored (16, r12-1i)", async () => {
    const pair = controlPair({ advertise: false, record: { status: "paused" } })
    const sent = await pair.carry.carry(loaded(pair), { parentSessionId: "parent-1", parentPauseSeq: 2, runRef: RUN }, "hello")
    expect(sent).toMatchObject({ kind: "not_continuable" })
    expect(sent.kind === "not_continuable" ? sent.reason : "").toStartWith("owner_cannot_apply: owner_unsupported")
    expect(pair.calls.resumeLost).toBe(0)
  })
})
