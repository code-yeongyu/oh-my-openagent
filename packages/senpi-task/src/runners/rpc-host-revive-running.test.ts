import { afterEach, describe, expect, spyOn, test } from "bun:test"

import type { TaskRecord } from "../state"
import { runTaskSend } from "../tools/control/send"
import { bounded, concurrencyOf, hostHolds, recordAt, startCancelLane, type CancelLane } from "./rpc-host/__fixtures__/cancel-lane"
import { HOST_CHILD_MODEL, type HostWorld } from "./rpc-host/__fixtures__/host-world"

/**
 * omo#9403: task_send to a parked child that is still RUNNING reopens its session and delivers the
 * message. Delivery is fenced like every other revival: a refused delivery hands the child back
 * parked instead of leaving a half-revived run, and a cancel that wins the record first is never
 * followed by a message to the cancelled child.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

async function parkedRunningChild(): Promise<{ readonly lane: CancelLane; readonly child: TaskRecord }> {
  const lane = await startCancelLane(worlds, 1)
  await lane.parent.startChildren(1)
  const child = recordAt(lane.parent, 0)
  const handle = lane.parent.manager.getResidentHandle(child.task_id)
  if (handle?.onParked === undefined) throw new Error("the child has no live host-session handle")
  const onParked = handle.onParked.bind(handle)
  const parked = new Promise<void>((resolve) => {
    onParked(() => resolve())
  })
  lane.world.host.evict(child.host_session?.session_path ?? "")
  await bounded(parked, "the idle park")
  expect(lane.parent.store.load(child.task_id)).toMatchObject({ status: "running", residency_state: "rpc_detached" })
  return { lane, child }
}

function promptsCarrying(lane: CancelLane, sentinel: string): number {
  return lane.world.prompts().filter((message) => message.includes(sentinel)).length
}

describe("task_send to a parked running child", () => {
  test("#given the host refuses the delivered message #when task_send reopens the child #then it answers a structured failure and the child is parked again, its lane free, and a later send still reaches it", async () => {
    // given
    const { lane, child } = await parkedRunningChild()
    const { world, parent } = lane
    world.host.failReply("prompt", "prompt refused by the host")

    // when
    const refused = await bounded(runTaskSend(parent.manager, { to: child.task_id, message: "REFUSED_SENTINEL" }, parent.sessionId), "task_send")

    // then
    expect(refused.details).toMatchObject({ kind: "not_continuable", task_id: child.task_id })
    expect(parent.store.load(child.task_id)).toMatchObject({ status: "running", residency_state: "rpc_detached" })
    expect(parent.manager.getResidentHandle(child.task_id)).toBeUndefined()
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)

    // when - the host takes messages again
    world.host.failReply("prompt", undefined)
    const delivered = await bounded(runTaskSend(parent.manager, { to: child.task_id, message: "ACCEPTED_SENTINEL" }, parent.sessionId), "the second task_send")

    // then
    expect(delivered.details).toMatchObject({ kind: "revived", task_id: child.task_id })
    expect(promptsCarrying(lane, "ACCEPTED_SENTINEL")).toBe(1)
  })

  test("#given a task_cancel that lands the moment the reopened child is reattached #when task_send would deliver to it #then nothing is sent to the cancelled child and the send is refused", async () => {
    // given
    const { lane, child } = await parkedRunningChild()
    const { world, parent } = lane
    const appendEvent = parent.store.appendEvent.bind(parent.store)
    let cancelling: Promise<unknown> | undefined
    spyOn(parent.store, "appendEvent").mockImplementation((taskId, event) => {
      const written = appendEvent(taskId, event)
      if (taskId === child.task_id && event.type === "reconcile_reattached") cancelling = parent.manager.cancelTask(child.task_id)
      return written
    })

    // when
    const sent = await bounded(runTaskSend(parent.manager, { to: child.task_id, message: "LATE_SENTINEL" }, parent.sessionId), "task_send")
    await bounded(cancelling ?? Promise.reject(new Error("the reopened child was never reattached")), "the racing task_cancel")

    // then
    expect(sent.details).toMatchObject({ kind: "not_continuable", task_id: child.task_id })
    expect(promptsCarrying(lane, "LATE_SENTINEL")).toBe(0)
    expect(parent.store.load(child.task_id)?.status).toBe("cancelled")
    expect(hostHolds(world, child)).toBe(false)
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)
  })
})

describe("a cancel that skips the abort", () => {
  test("#given a child still being launched, so it holds its lane with no live handle #when it is cancelled without abort #then its lane is released", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    world.host.withholdReply("open_session")
    const opening = world.host.waitForCommand("open_session")
    const starting = parent.startChildren(1).catch((error: unknown) => error)
    await bounded(opening, "the child's open_session")
    const child = recordAt(parent, 0)
    expect(parent.manager.getResidentHandle(child.task_id)).toBeUndefined()
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)

    // when
    const cancelled = await bounded(parent.manager.cancelTask(child.task_id, "dag node skipped", { abort: "skip" }), "the cancel")

    // then
    expect(cancelled.kind).toBe("cancelled")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(0)
    void starting
  })
})
