import { afterEach, describe, expect, test } from "bun:test"

import { runTaskCancel } from "../tools/control/cancel"
import { bounded, concurrencyOf, hostHolds, recordAt, startCancelLane } from "./rpc-host/__fixtures__/cancel-lane"
import { HOST_CHILD_MODEL, type HostWorld } from "./rpc-host/__fixtures__/host-world"

/**
 * omo#9403, seen live: a parent cancelled a child, the child's task-host shard crashed before the stop
 * reached it, and crash recovery reopened the child's session from its transcript - it ran on for
 * minutes after its record said cancelled. An accepted cancel is final: recovery that reaches the
 * host again ends the session there instead of bringing the child back.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

describe("a cancel the host crash interrupts", () => {
  test("#given task_cancel accepted for a running child #when its host shard dies before the stop lands and crash recovery reattaches #then the child is not running, the record is cancelled, and its lease is free", async () => {
    // given - the cancel is accepted and its abort is in flight
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(2)
    const child = recordAt(parent, 0)
    world.host.withholdReply("abort")
    const abortAsked = world.host.waitForCommand("abort")
    const cancelling = runTaskCancel(parent.manager, { task_id: child.task_id })
    await bounded(abortAsked, "the cancel's abort")
    const mark = world.host.commands.length

    // when - the shard dies and comes back; recovery reopens the child's session from its transcript
    const reopened = world.host.waitForCommand("open_session")
    const closed = world.host.waitForCommand("close_session")
    const nextPrompt = world.host.waitForCommand("prompt")
    await world.host.restart()
    await bounded(reopened, "crash recovery's reopen")
    const cancelled = await bounded(cancelling, "task_cancel")
    await bounded(closed, "the reopened session's close")
    world.host.allowReply("abort")

    // then
    expect(cancelled.details).toMatchObject({ kind: "cancelled", task_id: child.task_id })
    expect(parent.store.load(child.task_id)?.status).toBe("cancelled")
    expect(hostHolds(world, child)).toBe(false)
    expect(String((await bounded(nextPrompt, "the next child's prompt")).payload.message)).toBe("host child parent-a #1")
    expect(world.host.commands.slice(mark).filter((command) => command.type === "prompt")).toHaveLength(1)
    expect(recordAt(parent, 1).status).toBe("running")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
  })
})
