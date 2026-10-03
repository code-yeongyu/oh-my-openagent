import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { runTaskSend } from "../tools/control/send"
import type { FakeHost, FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import { HOST_CHILD_MODEL, startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"
import { manualRecoveryClock, type ManualRecoveryClock } from "./rpc-host/__fixtures__/manual-recovery-clock"
import type { ReattachOutcome } from "./rpc-host/handle-reattach"

/**
 * omo#9403: a child whose host transport drops must, within a bound, either run again or end
 * `failed: transport lost` with its lane released - never stay running on a connection that is gone.
 * Every connection here is a real unix socket to the fake host; the bound is a clock the suite fires.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

interface Lane {
  readonly world: HostWorld
  readonly parent: ParentSession
  readonly clock: ManualRecoveryClock
  readonly outcomes: ReattachOutcome[]
}

async function laneOf(slots: number, host: FakeHostOptions = {}, reattachDelaysMs: readonly number[] = [0, 0]): Promise<Lane> {
  const world = await startHostWorld(host)
  worlds.push(world)
  const clock = manualRecoveryClock()
  const outcomes: ReattachOutcome[] = []
  const parent = world.connect("parent-a", {
    settings: { default_concurrency: slots },
    reattachDelaysMs,
    recoveryClock: clock,
    shardEvents: { onReattachOutcome: (info) => outcomes.push(info.outcome) },
  })
  return { world, parent, clock, outcomes }
}

function concurrencyOf(parent: ParentSession) {
  const concurrency = parent.manager.concurrency
  if (concurrency === undefined) throw new Error("the manager exposes no concurrency")
  return concurrency
}

function recordAt(parent: ParentSession, index: number): TaskRecord {
  const record = parent.records()[index]
  if (record === undefined) throw new Error(`no child #${index}`)
  return record
}

async function settled(parent: ParentSession, taskId: string): Promise<TaskRecord> {
  return await parent.manager.waitFor(taskId, { signal: AbortSignal.timeout(10_000) })
}

/** Resolve once the host has seen `count` commands of `type`; checking and arming happen in one tick. */
async function commandsSeen(host: FakeHost, type: string, count: number): Promise<void> {
  while (host.commands.filter((command) => command.type === type).length < count) await host.waitForCommand(type)
}

/** A read on the child's current port waits for the recovery in flight to finish, never for time. */
async function joinRecovery(parent: ParentSession, record: TaskRecord): Promise<void> {
  const handle = parent.manager.getResidentHandle(record.task_id)
  if (handle?.getEntries === undefined) throw new Error(`${record.task_id} has no live host-session handle`)
  await handle.getEntries()
}

function routingOf(world: HostWorld, record: TaskRecord): string {
  const live = world.host.sessions().find((session) => session.sessionPath === record.host_session?.session_path)
  if (live === undefined) throw new Error(`the host holds no session for ${record.task_id}`)
  return live.routingId
}

describe("a child whose host transport drops", () => {
  test("#given a running child #when its socket closes and the host keeps the session #then it rejoins, new output arrives, and its lane frees for the next child", async () => {
    // given
    const { world, parent, clock, outcomes } = await laneOf(1)
    await parent.startChildren(2)
    const first = recordAt(parent, 0)
    const rejoined = world.host.waitForCommand("get_state")

    // when
    world.host.cutConnections()
    await rejoined

    // then - running again on the same session: its next output is delivered and settles the run
    await joinRecovery(parent, first)
    expect(clock.pending()).toBe(0)
    const nextPrompt = world.host.waitForCommand("prompt")
    world.host.completeTurn(routingOf(world, first), "finished after the cut")
    const done = await settled(parent, first.task_id)
    expect(done.status).toBe("completed")
    expect(done.final_response).toBe("finished after the cut")
    expect(outcomes).toEqual(["attached"])
    await nextPrompt
    expect(concurrencyOf(parent).leaseState(first.task_id, first.notification.run_epoch)).toBeUndefined()
    expect(recordAt(parent, 1).status).toBe("running")
  })

  test("#given a running child #when its socket closes and the host never answers the reopen #then within the bound the parent gets failed: transport lost, the lane admits the next child, and task_send names the loss", async () => {
    // given
    const { world, parent, clock } = await laneOf(1)
    await parent.startChildren(2)
    const first = recordAt(parent, 0)
    world.host.withholdReply("open_session")
    const reopenAsked = world.host.waitForCommand("open_session")

    // when - a real socket close, then the host stays silent until the bound runs out
    world.host.cutConnections()
    await reopenAsked
    world.host.allowReply("open_session")
    const nextPrompt = world.host.waitForCommand("prompt")
    clock.expire()

    // then
    const failed = await settled(parent, first.task_id)
    expect(failed.status).toBe("error")
    expect(failed.error_message).toContain("transport lost")
    await nextPrompt
    expect(concurrencyOf(parent).leaseState(first.task_id, first.notification.run_epoch)).toBeUndefined()
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
    expect(recordAt(parent, 1).status).toBe("running")
    const sent = await runTaskSend(parent.manager, { to: first.task_id, message: "still there?" }, parent.sessionId)
    expect(sent.details).toMatchObject({ kind: "not_continuable" })
    expect(JSON.stringify(sent.details)).toContain("transport lost")
    expect(JSON.stringify(sent.details)).not.toContain("lane_capacity")
  })

  test("#given several children on one host #when the host crashes, comes back, and never accepts the continuation #then each ends failed within the bound, nothing reports reattached, and every lease is released", async () => {
    // given
    const { world, parent, clock, outcomes } = await laneOf(3, {}, [0])
    await parent.startChildren(3)
    const children = [0, 1, 2].map((index) => recordAt(parent, index))
    world.host.withholdReply("prompt")

    // when - the host restarts empty; every child reopens and asks to continue, and the host never takes it
    await world.host.restart()
    await commandsSeen(world.host, "prompt", 6)

    // then - a continuation that was never taken is not a reattach
    expect(outcomes).toEqual([])
    clock.expire()
    for (const child of children) {
      const failed = await settled(parent, child.task_id)
      expect(failed.status).toBe("error")
      expect(failed.error_message).toContain("transport lost")
    }
    expect(outcomes).toEqual(["lost", "lost", "lost"])
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)
    expect(parent.records().filter((record) => record.residency_state === "rpc_detached")).toEqual([])
  })

  test("#given several children on one host #when the host crashes and comes back healthy #then each is re-prompted, reported reattached only once the host took the continuation, and runs to completion", async () => {
    // given
    const { world, parent, outcomes } = await laneOf(3, {}, [0])
    await parent.startChildren(3)
    const children = [0, 1, 2].map((index) => recordAt(parent, index))

    // when
    await world.host.restart()
    await commandsSeen(world.host, "prompt", 6)

    // then
    for (const child of children) world.host.completeTurn(routingOf(world, child), `resumed ${child.task_id}`)
    for (const child of children) expect((await settled(parent, child.task_id)).status).toBe("completed")
    for (const child of children) await joinRecovery(parent, child)
    expect(outcomes).toEqual(["continued", "continued", "continued"])
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)
  })

  test("#given a child that started a long-running process #when it fails with transport lost and its host answers again #then its session is closed on the host and the process is gone", async () => {
    // given
    const { world, parent, clock } = await laneOf(1, { sessionProcesses: true })
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = world.host.sessions().find((candidate) => candidate.sessionPath === child.host_session?.session_path)
    if (session?.processPid === undefined || session.processExit === undefined) throw new Error("the child's session has no process")
    world.host.withholdReply("open_session")
    const reopenAsked = world.host.waitForCommand("open_session")
    world.host.cutConnections()
    await reopenAsked
    clock.expire()
    const failed = await settled(parent, child.task_id)
    expect(failed.error_message).toContain("transport lost")

    // when - the host answers again: the stalled reopen dies with its socket and the next one lands
    world.host.allowReply("open_session")
    const closed = world.host.waitForCommand("close_session")
    world.host.cutConnections()
    await closed

    // then
    await Promise.race([session.processExit, rejectAfter(10_000, "the child's process never exited")])
    expect(processAlive(session.processPid)).toBe(false)
    expect(world.host.sessions().some((candidate) => candidate.sessionPath === child.host_session?.session_path)).toBe(false)
  })

  test("#given a healthy child quiet past the bound #when the recovery clock runs out #then nothing is armed, it keeps running, and its lease stays held", async () => {
    // given
    const { world, parent, clock } = await laneOf(1)
    await parent.startChildren(1)
    const child = recordAt(parent, 0)

    // when - no transport loss: a quiet child is not a lost one
    clock.expire()

    // then
    expect(clock.pending()).toBe(0)
    expect(parent.store.load(child.task_id)?.status).toBe("running")
    expect(concurrencyOf(parent).leaseState(child.task_id, child.notification.run_epoch)).toBe("held")
    expect(world.commandsOfType("abort") + world.commandsOfType("close_session")).toBe(0)
    world.host.completeTurn(routingOf(world, child), "done while quiet")
    expect((await settled(parent, child.task_id)).status).toBe("completed")
  })

  test("#given a stopped task host under a live parent with children holding every slot #when the bound runs out #then their leases are reclaimed, the pending child starts, and its own lease is never reclaimed", async () => {
    // given - the host is stopped and replaced by one that never answers a reopen
    const { world, parent, clock } = await laneOf(2, {}, [0])
    await parent.startChildren(3)
    const [first, second, pending] = [0, 1, 2].map((index) => recordAt(parent, index))
    if (first === undefined || second === undefined || pending === undefined) throw new Error("three children expected")
    expect(pending.status).toBe("pending")
    world.host.withholdReply("open_session")
    await world.host.restart()
    await commandsSeen(world.host, "open_session", 4)
    world.host.allowReply("open_session")
    const pendingPrompt = world.host.waitForCommand("prompt")

    // when
    clock.expire()

    // then
    expect((await settled(parent, first.task_id)).status).toBe("error")
    expect((await settled(parent, second.task_id)).status).toBe("error")
    await pendingPrompt
    const started = parent.store.load(pending.task_id)
    expect(started?.status).toBe("running")
    clock.expire()
    expect(parent.store.load(pending.task_id)?.status).toBe("running")
    expect(concurrencyOf(parent).leaseState(pending.task_id, started?.notification.run_epoch ?? -1)).toBe("held")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
  })
})

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
  })
}
