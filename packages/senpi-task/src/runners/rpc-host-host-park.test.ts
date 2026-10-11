import { afterEach, describe, expect, test } from "bun:test"

import type { SuspensionReason, TaskRecord, TaskStatus } from "../state"
import { runTaskSend } from "../tools/control/send"
import { runTaskOutput } from "../tools/output/output"
import type { FakeHostOptions } from "./rpc-host/__fixtures__/fake-host"
import { HOST_CHILD_MODEL, startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"

/**
 * The HOST parks a child's session (idle sweep, generation handoff): the record must follow - parked
 * at rpc_detached with the host's cause, the run released - so task_output, revival and reconcile
 * see a parked child instead of a resident one whose outcome never settles.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

type Child = { readonly world: HostWorld; readonly parent: ParentSession; readonly record: TaskRecord; readonly routingId: string }

function concurrencyOf(parent: ParentSession) {
  const concurrency = parent.manager.concurrency
  if (concurrency === undefined) throw new Error("the manager exposes no concurrency")
  return concurrency
}

async function oneChild(options: FakeHostOptions = {}): Promise<Child> {
  const world = await startHostWorld({ drainRetryAfterMs: 250, ...options })
  worlds.push(world)
  const parent = world.connect("parent-a", { maxDrainAttempts: 1 })
  await parent.startChildren(1)
  const [record] = parent.records()
  const [session] = world.host.sessions()
  if (record === undefined || session === undefined) throw new Error("the child did not start on the host")
  expect(concurrencyOf(parent).leaseState(record.task_id, record.notification.run_epoch)).toBe("held")
  return { world, parent, record, routingId: session.routingId }
}

// The manager's park listener was registered when the run was tracked, so a listener added now runs
// after it: the park has reached the record by the time this resolves. Nothing is polled.
function parkSeen(child: Child): Promise<void> {
  const handle = child.parent.manager.getResidentHandle(child.record.task_id)
  if (handle?.onParked === undefined) throw new Error("the child has no live host-session handle")
  const onParked = handle.onParked.bind(handle)
  return new Promise<void>((resolve) => {
    onParked(() => resolve())
  })
}

async function expectParked(child: Child, reason: SuspensionReason, status: TaskStatus): Promise<void> {
  const { parent, record } = child
  const parked = parent.store.load(record.task_id)
  expect(parked?.residency_state).toBe("rpc_detached")
  expect(parked?.suspension_reason).toBe(reason)
  expect(parked?.status).toBe(status)
  expect(parked?.host_pid).toBeUndefined()
  expect(parked?.host_session?.session_path).toBe(record.host_session?.session_path)
  expect(parent.manager.getResidentHandle(record.task_id)).toBeUndefined()
  expect(concurrencyOf(parent).leaseState(record.task_id, record.notification.run_epoch)).toBeUndefined()
  expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)
  const output = await runTaskOutput({ manager: parent.manager, stateDir: parent.store.stateDir }, { task_id: record.task_id }, parent.sessionId)
  expect(output.details).toMatchObject({ kind: "status", snapshot: { residency_state: "rpc_detached", status } })
  expect(output.details.kind === "status" && output.details.snapshot.suspended !== undefined).toBe(status === "running" || status === "pending")
}

describe("a session the host parks parks its task record", () => {
  test("#given a running child #when the idle sweep parks its retained session #then the record is rpc_detached idle_evicted, released, and a later session start reattaches it", async () => {
    // given
    const child = await oneChild()
    const seen = parkSeen(child)

    // when
    child.world.host.evict(child.record.host_session?.session_path ?? "")
    await seen

    // then
    await expectParked(child, "idle_evicted", "running")

    // when - the parent's next session start reconciles its parked child
    const revived = await child.world.connect("parent-a").lifecycle.reconcileOnSessionStart("parent-a")

    // then - reopened on the same host from its transcript, no prompt replayed
    expect(revived.outcomes.map((outcome) => outcome.kind)).toEqual(["resumed"])
    expect(child.parent.store.load(child.record.task_id)).toMatchObject({ residency_state: "resident", status: "running" })
    expect(child.parent.store.load(child.record.task_id)?.suspension_reason).toBeUndefined()
    expect(child.world.prompts()).toHaveLength(1)
  })

  test("#given a running child #when the host closes its session as idle_evicted #then the record is rpc_detached idle_evicted and released", async () => {
    // given
    const child = await oneChild()
    const seen = parkSeen(child)

    // when
    child.world.host.closeSession(child.routingId, "idle_evicted")
    await seen

    // then
    await expectParked(child, "idle_evicted", "running")
  })

  test("#given a running child #when a generation handoff parks its session #then the record is rpc_detached handoff_parked, released, and reattaches once the old generation drains", async () => {
    // given
    const child = await oneChild()
    const paths = child.parent.sessionPaths()
    const seen = parkSeen(child)

    // when
    child.world.host.handoff()
    await seen

    // then
    await expectParked(child, "handoff_parked", "running")

    // when - the old generation finishes draining and the parent's next session start reconciles
    for (const path of paths) child.world.host.releasePath(path)
    const revived = await child.world.connect("parent-a").lifecycle.reconcileOnSessionStart("parent-a")

    // then
    expect(revived.outcomes.map((outcome) => outcome.kind)).toEqual(["resumed"])
    expect(child.parent.store.load(child.record.task_id)).toMatchObject({ residency_state: "resident", status: "running" })
    expect(child.parent.store.load(child.record.task_id)?.host_session?.instance_id).toBe(child.world.host.instanceId)
    expect(child.world.prompts()).toHaveLength(1)
  })

  test("#given a child whose turn completed while it stayed resident #when the idle sweep parks its session #then the completed record parks idle_evicted instead of keeping a dead handle", async () => {
    // given
    const child = await oneChild()
    child.world.host.completeTurn(child.routingId, "DONE_SENTINEL")
    const completed = await child.parent.manager.waitFor(child.record.task_id, { signal: AbortSignal.timeout(10_000) })
    expect(completed.status).toBe("completed")
    expect(child.parent.store.load(child.record.task_id)?.residency_state).toBe("resident")
    const seen = parkSeen(child)

    // when
    child.world.host.evict(child.record.host_session?.session_path ?? "")
    await seen

    // then - never turned into a failure: the result stays, only the residency moves
    await expectParked(child, "idle_evicted", "completed")
    expect(child.parent.store.load(child.record.task_id)?.final_response).toBe("DONE_SENTINEL")
  })

  test("#given a running child the idle sweep parked #when task_send reaches it on a free lane #then it is reopened and delivered to instead of answering lane_capacity, and its run releases the lane when it ends (omo#9403)", async () => {
    // given
    const child = await oneChild({ transcripts: true })
    const seen = parkSeen(child)
    child.world.host.evict(child.record.host_session?.session_path ?? "")
    await seen
    await expectParked(child, "idle_evicted", "running")
    const delivered = child.world.host.waitForCommand("prompt")

    // when
    const sent = await runTaskSend(child.parent.manager, { to: child.record.task_id, message: "KEEP_GOING_SENTINEL" }, child.parent.sessionId)

    // then
    expect(JSON.stringify(sent.details)).not.toContain("lane_capacity")
    expect(String((await delivered).payload.message)).toContain("KEEP_GOING_SENTINEL")
    const revived = child.parent.store.load(child.record.task_id)
    expect(revived).toMatchObject({ status: "running", residency_state: "resident" })
    const live = child.world.host.sessions().find((session) => session.sessionPath === child.record.host_session?.session_path)
    if (live === undefined) throw new Error("the revived session is not open on the host")
    child.world.host.completeTurn(live.routingId, "DONE_AFTER_REVIVAL")
    const done = await child.parent.manager.waitFor(child.record.task_id, { signal: AbortSignal.timeout(10_000) })
    expect(done).toMatchObject({ status: "completed", final_response: "DONE_AFTER_REVIVAL" })
    expect(concurrencyOf(child.parent).getCount(HOST_CHILD_MODEL)).toBe(0)
  })

  test("#given a completed child a handoff parked #when task_send revives it on the new generation #then the record names the session the new generation serves", async () => {
    // given
    const child = await oneChild({ transcripts: true })
    const paths = child.parent.sessionPaths()
    child.world.host.completeTurn(child.routingId, "DONE_SENTINEL")
    await child.parent.manager.waitFor(child.record.task_id, { signal: AbortSignal.timeout(10_000) })
    const seen = parkSeen(child)
    child.world.host.handoff()
    await seen
    await expectParked(child, "handoff_parked", "completed")
    for (const path of paths) child.world.host.releasePath(path)
    const previousInstance = child.record.host_session?.instance_id

    // when
    const sent = await runTaskSend(child.parent.manager, { to: child.record.task_id, message: "AGAIN_SENTINEL" }, child.parent.sessionId)

    // then
    expect(sent.details).toMatchObject({ kind: "revived" })
    const live = child.world.host.sessions().find((session) => session.sessionPath === child.record.host_session?.session_path)
    const revived = child.parent.store.load(child.record.task_id)
    expect(child.world.host.instanceId).not.toBe(previousInstance)
    expect(revived?.host_session?.instance_id).toBe(child.world.host.instanceId)
    expect(revived?.host_session?.routing_id).toBe(live?.routingId)
    expect(revived?.suspension_reason).toBeUndefined()
  })
})
