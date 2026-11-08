import { afterEach, describe, expect, test } from "bun:test"

import { defaultHostSessionProbe } from "../lifecycle/host-session-default"
import type { TaskRecord } from "../state"
import { startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"

/**
 * #8932: a daemon-hosted child belongs to the omo process that launched it. Every OTHER omo process
 * sharing the project store reconciles that store on session start, and it may only leave the child
 * alone if the production liveness adapter reports the child's worker session as live. When it
 * reads as dead, the other process claims the child, the owner's outcome is fenced off, and a DAG
 * node waiting on the owner's waitFor stays `running` forever.
 */

const OTHER_PROCESS_PID = 2_000_000_001
const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${what}; it never settled`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function oneLiveChild(): Promise<{ readonly world: HostWorld; readonly owner: ParentSession; readonly record: TaskRecord }> {
  const world = await startHostWorld()
  worlds.push(world)
  const owner = world.connect("parent-owner")
  await owner.startChildren(1)
  const [record] = owner.records()
  if (record?.host_session === undefined) throw new Error("the owner's child never reached the daemon")
  return { world, owner, record }
}

describe("a daemon-hosted child stays with the process that launched it (#8932)", () => {
  test("#given a live worker child on the daemon #when the production probe asks #then its session reads as live", async () => {
    // given
    const { record } = await oneLiveChild()
    const identity = record.host_session
    if (identity === undefined) throw new Error("unreachable: oneLiveChild checked host_session")
    const probe = defaultHostSessionProbe()

    // when
    const daemonAlive = await probe.daemonAlive(identity)
    const sessionLive = await probe.sessionLive(identity)

    // then
    expect(daemonAlive).toBe(true)
    expect(sessionLive).toBe(true)
  })

  test("#given a live child owned by one process #when another process starts a session #then it leaves the child alone and the owner's waitFor settles on completion", async () => {
    // given
    const { world, owner, record } = await oneLiveChild()
    const settled = owner.manager.waitFor(record.task_id)
    const other = world.connect("parent-other", { hostPid: OTHER_PROCESS_PID, productionProbe: true })

    // when
    const result = await other.lifecycle.reconcileOnSessionStart("parent-other")

    // then - the other process defers to the live owner and never claims the record
    expect(result.outcomes).toContainEqual({ task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" })
    const untouched = owner.store.load(record.task_id)
    expect(untouched?.host_pid).toBe(record.host_pid)
    expect(untouched?.residency_state).toBe("resident")
    expect(untouched?.notification.run_epoch).toBe(record.notification.run_epoch)

    // when - the child finishes its turn
    const session = world.host.sessions().find((candidate) => candidate.sessionPath === record.host_session?.session_path)
    world.host.completeTurn(session?.routingId ?? "", "done")

    // then - the owner, and so any DAG node waiting on it, observes the terminal record
    const terminal = await within(settled, 5_000, "the owner's waitFor")
    expect(terminal.status).toBe("completed")
  })
})
