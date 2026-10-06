import { afterEach, describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import { runTaskCancel } from "../tools/control/cancel"
import { runTaskOutput } from "../tools/output/output"
import { HOST_CHILD_MODEL, startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"
import { manualRecoveryClock, type ManualRecoveryClock } from "./rpc-host/__fixtures__/manual-recovery-clock"

/**
 * omo#9403: a cancelled child must actually stop. A child whose transport is down when it is
 * cancelled reports the cancel as pending - never a false `cancelled` - and the cancel runs on the
 * host BEFORE anything else once the child is reachable again; only then is its lane released.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

interface Lane {
  readonly world: HostWorld
  readonly parent: ParentSession
  readonly clock: ManualRecoveryClock
}

async function laneOf(slots: number): Promise<Lane> {
  const world = await startHostWorld({ sessionProcesses: true })
  worlds.push(world)
  const clock = manualRecoveryClock()
  const parent = world.connect("parent-a", { settings: { default_concurrency: slots }, reattachDelaysMs: [0, 0], recoveryClock: clock })
  return { world, parent, clock }
}

function recordAt(parent: ParentSession, index: number): TaskRecord {
  const record = parent.records()[index]
  if (record === undefined) throw new Error(`no child #${index}`)
  return record
}

function concurrencyOf(parent: ParentSession) {
  const concurrency = parent.manager.concurrency
  if (concurrency === undefined) throw new Error("the manager exposes no concurrency")
  return concurrency
}

function sessionOf(world: HostWorld, record: TaskRecord) {
  const session = world.host.sessions().find((candidate) => candidate.sessionPath === record.host_session?.session_path)
  if (session === undefined) throw new Error(`the host holds no session for ${record.task_id}`)
  return session
}

function commandsFor(world: HostWorld, routingId: string, from: number): readonly string[] {
  return world.host.commands.slice(from).filter((command) => command.sessionId === routingId).map((command) => command.type)
}

function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} did not settle within 10s`)), 10_000)
      timer.unref?.()
    }),
  ])
}

describe("task_cancel stops the child", () => {
  test("#given a child whose socket dropped #when it is cancelled and later reachable again #then the cancel is pending until the host ends it first, the lease is released once, and the next child starts", async () => {
    // given
    const { world, parent } = await laneOf(1)
    await parent.startChildren(2)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    world.host.withholdReply("open_session")
    const reopenAsked = world.host.waitForCommand("open_session")
    world.host.cutConnections()
    await reopenAsked

    // when - cancelled while unreachable
    const cancelled = await bounded(runTaskCancel(parent.manager, { task_id: child.task_id }), "task_cancel")

    // then - never a false cancelled, and the lane is still held by a child that may still run
    expect(cancelled.details).toMatchObject({ kind: "cancel_pending", task_id: child.task_id })
    const pendingView = await runTaskOutput({ manager: parent.manager, stateDir: parent.store.stateDir }, { task_id: child.task_id }, parent.sessionId)
    expect(JSON.stringify(pendingView.details)).toContain("cancel requested, child unreachable")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
    expect(recordAt(parent, 1).status).toBe("pending")

    // when - the transport recovers
    const mark = world.host.commands.length
    world.host.allowReply("open_session")
    const closed = world.host.waitForCommand("close_session")
    const nextPrompt = world.host.waitForCommand("prompt")
    world.host.cutConnections()
    await closed
    await nextPrompt

    // then - the cancel ran before anything else; nothing was re-prompted; the process ended with it
    const sentAfter = world.host.commands.slice(mark).filter((command) => command.type === "prompt" || command.type === "steer" || command.type === "followUp")
    expect(sentAfter.map((command) => String(command.payload.message))).toEqual(["host child parent-a #1"])
    expect(world.host.sessions().some((candidate) => candidate.sessionPath === session.sessionPath)).toBe(false)
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")
    expect(stopped.status).toBe("cancelled")
    expect(recordAt(parent, 1).status).toBe("running")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
    parent.manager.forget(child.task_id)
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
  })

  test("#given a child the parent parked while its session still runs on the host #when it is cancelled #then the session is closed on the host and its process is gone", async () => {
    // given - the parent let go of the session, which keeps running on the host
    const { world, parent } = await laneOf(1)
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    const handle = parent.manager.getResidentHandle(child.task_id)
    if (handle === undefined) throw new Error("the child has no live handle")
    await handle.dispose()
    parent.store.mutate(child.task_id, (fresh) => {
      const { host_pid: _owner, ...rest } = fresh
      return { ...rest, residency_state: "rpc_detached" }
    })
    parent.manager.forget(child.task_id)
    const mark = world.host.commands.length

    // when
    const cancelled = await bounded(runTaskCancel(parent.manager, { task_id: child.task_id }), "task_cancel")

    // then
    expect(cancelled.details).toMatchObject({ kind: "cancelled" })
    expect(commandsFor(world, session.routingId, mark)).not.toContain("prompt")
    expect(world.host.sessions().some((candidate) => candidate.sessionPath === session.sessionPath)).toBe(false)
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
    expect(parent.store.load(child.task_id)?.status).toBe("cancelled")
  })
})
