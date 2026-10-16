import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { runTaskSend } from "../tools/control/send"
import type { FakeHost, FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import { HOST_CHILD_MODEL, startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"
import { hostWorldRecovery } from "./rpc-host/__fixtures__/host-world-recovery"
import { manualRecoveryClock, type ManualRecoveryClock } from "./rpc-host/__fixtures__/manual-recovery-clock"
import { LIVE_PARENT_SUSPENSION_BUDGET_MS } from "../lifecycle/live-parent-recovery"
import type { ReattachOutcome } from "./rpc-host/handle-reattach"

/**
 * omo#9403, omo#10023: a child whose host transport drops must, within a bound, either run again or
 * park for live-parent recovery with its lane released - never stay running on a connection that is
 * gone. A parked child is respawned from its recorded launch when the host and a slot allow it, and
 * only when that fails does it end with one plain notice naming the cause and the user's action.
 * Every connection here is a real unix socket to the fake host; the reattach bound is a clock the
 * suite fires, and the live-parent recovery budget is a second clock it advances.
 */

const worlds: HostWorld[] = []
/** The host-close deadline, on the same controlled clock as the recovery budget. */
const CLOSE_DEADLINE_MS = 10_000

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

interface Lane {
  readonly world: HostWorld
  readonly parent: ParentSession
  readonly clock: ManualRecoveryClock
  readonly live: ReturnType<typeof hostWorldRecovery>
  readonly outcomes: ReattachOutcome[]
}

async function laneOf(slots: number, host: FakeHostOptions = {}, reattachDelaysMs: readonly number[] = [0, 0]): Promise<Lane> {
  const world = await startHostWorld(host)
  worlds.push(world)
  const clock = manualRecoveryClock()
  const live = hostWorldRecovery()
  const outcomes: ReattachOutcome[] = []
  const parent = world.connect("parent-a", {
    settings: { default_concurrency: slots },
    reattachDelaysMs,
    recoveryClock: clock,
    liveRecovery: live,
    hostCloseTimeoutMs: CLOSE_DEADLINE_MS,
    shardEvents: { onReattachOutcome: (info) => outcomes.push(info.outcome) },
  })
  return { world, parent, clock, live, outcomes }
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
  const segment = `/children/${record.task_id}/`
  const live = world.host.sessions().findLast((session) => session.sessionPath.replaceAll("\\", "/").includes(segment))
  if (live === undefined) throw new Error(`the host holds no session for ${record.task_id}`)
  return live.routingId
}

/** Parked for live-parent recovery: detached with its cause, still unfinished, and holding no lease. */
function parkedFor(parent: ParentSession, taskId: string): boolean {
  const record = parent.store.load(taskId)
  return record?.residency_state === "rpc_detached" && record.suspension_reason !== undefined
    && (record.status === "running" || record.status === "pending")
}

/**
 * The one result a child ends with once live-parent recovery runs out: a reason and an action, no
 * transport jargon, delivered to the parent exactly once, with the stop recorded as confirmed or not.
 */
function expectRecoveryNotice(lane: Lane, record: TaskRecord, confirmedStop: boolean): void {
  expect(record.status).toBe("error")
  expect(record.failure_kind).toBe("suspended_unresumable")
  expect(record.error_message).toContain("Retry")
  expect(record.error_message).not.toContain("transport lost")
  const results = lane.live.messages.filter((message) => JSON.stringify(message).includes(`id:${record.task_id} `))
  expect(results).toHaveLength(1)
  expect(record.fallback_closing_child !== undefined).toBe(!confirmedStop)
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

  test("#given a running child #when its socket closes and the host never answers the reopen #then within the bound it parks with its lane released, task_send queues for it, and it is respawned on the same session once a slot frees", async () => {
    // given
    const { world, parent, clock, live } = await laneOf(1)
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

    // then - parked, not failed: the lane admits the next child and a message waits for the respawn
    await live.until(() => parkedFor(parent, first.task_id))
    await nextPrompt
    expect(concurrencyOf(parent).leaseState(first.task_id, first.notification.run_epoch)).toBeUndefined()
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
    const second = recordAt(parent, 1)
    expect(second.status).toBe("running")
    const sent = await runTaskSend(parent.manager, { to: first.task_id, message: "still there?" }, parent.sessionId)
    expect(sent.details).toMatchObject({ kind: "queued" })
    expect(JSON.stringify(sent.details)).not.toContain("transport lost")

    // when the next child finishes, the next recovery retry respawns the parked one on its own session
    await live.until(() => parent.store.load(first.task_id)?.revival_deferred_reason === "capacity")
    world.host.completeTurn(routingOf(world, second), "second done")
    expect((await settled(parent, second.task_id)).status).toBe("completed")
    const steered = world.host.waitForCommand("steer")
    live.advance(5_000)
    await live.until(() => parent.store.load(first.task_id)?.residency_state === "resident"
      && parent.store.load(first.task_id)?.suspension_reason === undefined)
    expect(parent.store.load(first.task_id)?.host_session?.session_path).toBe(first.host_session?.session_path)

    // then the message acknowledged as queued reaches the respawned child before its run ends
    expect(JSON.stringify(await steered)).toContain("still there?")
    await live.until(() => (parent.store.load(first.task_id)?.pending_steering?.length ?? 0) === 0)
    world.host.completeTurn(routingOf(world, first), "finished after the respawn")
    const done = await settled(parent, first.task_id)
    expect(done.status).toBe("completed")
    expect(done.final_response).toBe("finished after the respawn")
    expect(done.error_message).toBeUndefined()
  })

  test("#given a message queued for a parked child #when the respawned run finishes before that message is acknowledged #then the result keeps the answer and says the message is still queued, and the next task_send delivers it first", async () => {
    // given
    const { world, parent, clock, live } = await laneOf(1)
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    world.host.withholdReply("open_session")
    const reopenAsked = world.host.waitForCommand("open_session")
    world.host.cutConnections()
    await reopenAsked
    world.host.allowReply("open_session")
    clock.expire()
    await live.until(() => parkedFor(parent, child.task_id))
    const sent = await runTaskSend(parent.manager, { to: child.task_id, message: "one more thing" }, parent.sessionId)
    expect(sent.details).toMatchObject({ kind: "queued" })

    // when - the respawned run ends before the host acknowledges the queued message
    world.host.withholdReply("steer")
    const firstSteer = world.host.waitForCommand("steer")
    live.advance(5_000)
    await firstSteer
    world.host.completeTurn(routingOf(world, child), "done before the message landed")

    // then
    const done = await settled(parent, child.task_id)
    expect(done.status).toBe("completed")
    expect(done.final_response).toBe("done before the message landed")
    expect(done.pending_steering?.map((entry) => entry.message)).toEqual(["one more thing"])
    await live.until(() => live.messages.some((message) => JSON.stringify(message).includes(`id:${child.task_id} `)))
    const results = live.messages.filter((message) => JSON.stringify(message).includes(`id:${child.task_id} `))
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results[0])).toContain("still queued")
    expect(JSON.stringify(results[0])).toContain("task_send")

    // and the next continuation delivers the queued message first, in order
    world.host.allowReply("steer")
    const continued = world.host.waitForCommand("prompt")
    await runTaskSend(parent.manager, { to: child.task_id, message: "and this" }, parent.sessionId)
    const prompt = JSON.stringify(await continued)
    expect(prompt.indexOf("one more thing")).toBeGreaterThanOrEqual(0)
    expect(prompt.indexOf("one more thing")).toBeLessThan(prompt.indexOf("and this"))
  })

  test("#given several children on one host #when the host crashes, comes back, and never accepts the continuation #then each parks with its lease released, nothing reports reattached, and after the recovery budget each ends with one plain notice", async () => {
    // given
    const lane = await laneOf(3, {}, [0])
    const { world, parent, clock, live, outcomes } = lane
    await parent.startChildren(3)
    const children = [0, 1, 2].map((index) => recordAt(parent, index))
    world.host.withholdReply("prompt")

    // when - the host restarts empty; every child reopens and asks to continue, and the host never takes it
    await world.host.restart()
    await commandsSeen(world.host, "prompt", 6)

    // then - a continuation that was never taken is not a reattach
    expect(outcomes).toEqual([])
    clock.expire()
    await live.until(() => outcomes.length === 3)
    expect(outcomes).toEqual(["lost", "lost", "lost"])
    for (const child of children) expect(concurrencyOf(parent).leaseState(child.task_id, child.notification.run_epoch)).toBeUndefined()

    // when - the host never takes a continuation for the whole live-parent recovery budget, nor
    // answers the close that ends it: the close deadline releases each child, not the host
    live.advance(LIVE_PARENT_SUSPENSION_BUDGET_MS + 1)
    await live.until(() => children.every((child) => parent.store.load(child.task_id)?.failure_kind === "suspended_unresumable"))
    live.advance(CLOSE_DEADLINE_MS)

    // then
    for (const child of children) expectRecoveryNotice(lane, await settled(parent, child.task_id), false)
    // The last slot frees on the store write that follows the final terminal transition.
    await live.until(() => concurrencyOf(parent).getCount(HOST_CHILD_MODEL) === 0)
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

  test("#given a child that started a long-running process #when its parked recovery runs out and its host answers again #then its session is closed on the host and the process is gone", async () => {
    // given
    const lane = await laneOf(1, { sessionProcesses: true })
    const { world, parent, clock, live } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = world.host.sessions().find((candidate) => candidate.sessionPath === child.host_session?.session_path)
    if (session?.processPid === undefined || session.processExit === undefined) throw new Error("the child's session has no process")
    world.host.withholdReply("open_session")
    const reopenAsked = world.host.waitForCommand("open_session")
    world.host.cutConnections()
    await reopenAsked
    clock.expire()
    // A parked session is kept for its respawn: the process is still there while recovery may run.
    await live.until(() => parkedFor(parent, child.task_id))
    expect(processAlive(session.processPid)).toBe(true)

    // when - recovery runs out, then the host answers again: the stalled reopen dies with its socket and the close lands
    world.host.allowReply("open_session")
    const closed = world.host.waitForCommand("close_session")
    live.advance(LIVE_PARENT_SUSPENSION_BUDGET_MS + 1)
    expectRecoveryNotice(lane, await settled(parent, child.task_id), true)
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

  test("#given a stopped task host under a live parent with children holding every slot #when the bound runs out #then they park with their leases reclaimed, the pending child starts, and its own lease is never reclaimed", async () => {
    // given - the host is stopped and replaced by one that never answers a reopen
    const { world, parent, clock, live } = await laneOf(2, {}, [0])
    await parent.startChildren(3)
    const [first, second, pending] = [0, 1, 2].map((index) => recordAt(parent, index))
    if (first === undefined || second === undefined || pending === undefined) throw new Error("three children expected")
    expect(pending.status).toBe("pending")
    world.host.withholdReply("open_session")
    await world.host.restart()
    await commandsSeen(world.host, "open_session", 4)
    world.host.allowReply("open_session")
    // Hold every prompt unanswered: the first parked child's revival then stays in flight (claimed
    // resident, cause recorded) instead of racing these assertions to land and clear its cause.
    world.host.withholdReply("prompt")

    // when
    clock.expire()

    // then - the pending child's first prompt and the revival's continuation have both been sent
    await commandsSeen(world.host, "prompt", 4)
    for (const parked of [first, second]) {
      expect(parent.store.load(parked.task_id)?.status).not.toBe("error")
      expect(concurrencyOf(parent).leaseState(parked.task_id, parked.notification.run_epoch)).toBeUndefined()
    }
    const started = parent.store.load(pending.task_id)
    expect(started?.status).toBe("running")
    clock.expire()
    expect(parent.store.load(pending.task_id)?.status).toBe("running")
    expect(concurrencyOf(parent).leaseState(pending.task_id, started?.notification.run_epoch ?? -1)).toBe("held")
    // The second slot is the live-parent revival's reservation for the first parked child, which is
    // being respawned (claimed resident, cause still recorded) and has no run lease until it attaches;
    // the other stays parked behind it.
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(2)
    const [revived, waiting] = [first, second].map((child) => parent.store.load(child.task_id))
    expect([revived?.residency_state, revived?.suspension_reason]).toEqual(["resident", "daemon_unavailable"])
    expect([waiting?.residency_state, waiting?.suspension_reason]).toEqual(["rpc_detached", "daemon_unavailable"])
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
