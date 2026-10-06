import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { transitionTaskRecord, type TaskTransition } from "../state"
import { runTaskCancel } from "../tools/control/cancel"
import { runTaskOutput } from "../tools/output/output"
import {
  bounded,
  cancelUnreachable,
  commandsSeen,
  concurrencyOf,
  hostHolds,
  recordAt,
  sessionOf,
  startCancelLane,
} from "./rpc-host/__fixtures__/cancel-lane"
import { HOST_CHILD_MODEL, type HostWorld } from "./rpc-host/__fixtures__/host-world"

/**
 * omo#9403: a cancel that has to wait for a child's lost connection must always end the run. Whatever
 * happens before the stop lands - a failed record write, a recovery that never gets the child back,
 * the parent session shutting down, a competing interrupt - the task ends cancelled, its lane frees,
 * and the child never runs again.
 */

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

describe("a pending cancel always ends the run", () => {
  test("#given a pending cancel whose cancelled-record write fails once #when the stop lands #then the run still ends cancelled, its waiter settles, and the next child takes the lane", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(2)
    const child = recordAt(parent, 0)
    await cancelUnreachable(lane, child)
    const transition = parent.store.transition.bind(parent.store)
    let failed = false
    spyOn(parent.store, "transition").mockImplementation((taskId: string, next: TaskTransition) => {
      if (!failed && taskId === child.task_id && next.type === "cancel") {
        failed = true
        throw new Error("EPERM: the record could not be written")
      }
      return transition(taskId, next)
    })

    // when - the transport recovers and the stop runs on the host
    world.host.allowReply("open_session")
    const nextPrompt = world.host.waitForCommand("prompt")
    world.host.cutConnections()
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")

    // then
    expect(failed).toBe(true)
    expect(stopped.status).toBe("cancelled")
    expect(String((await bounded(nextPrompt, "the next child's prompt")).payload.message)).toBe("host child parent-a #1")
    expect(recordAt(parent, 1).status).toBe("running")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
  })

  test("#given a pending cancel #when the transport's recovery exhausts its attempts without reaching the host #then the cancel settles, the session still ends on the host, and the lane frees", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(2)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    await cancelUnreachable(lane, child)
    const opensBefore = world.commandsOfType("open_session")

    // when - every remaining reopen attempt is refused
    world.host.failOpen({ code: "open_failed", detail: "the session store is unavailable" })
    world.host.allowReply("open_session")
    const lastAttempt = commandsSeen(world.host, "open_session", opensBefore + 1).then(() => world.host.failOpen(undefined))
    const nextPrompt = world.host.waitForCommand("prompt")
    world.host.cutConnections()
    await bounded(lastAttempt, "the last reopen attempt")
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")

    // then
    expect(stopped.status).toBe("cancelled")
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
    expect(hostHolds(world, child)).toBe(false)
    expect(String((await bounded(nextPrompt, "the next child's prompt")).payload.message)).toBe("host child parent-a #1")
    expect(recordAt(parent, 1).status).toBe("running")
  })

  test("#given a pending cancel #when the parent session shuts down before the stop lands and the parent restarts #then the child is not revived: it ends cancelled and its session is closed on the host", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    await cancelUnreachable(lane, child)
    await parent.lifecycle.suspendOnSessionShutdown({ parentSessionId: parent.sessionId, reason: "session_shutdown" })
    expect(parent.store.load(child.task_id)).toMatchObject({ status: "running", residency_state: "rpc_detached" })

    // when - the parent's next session starts while its host answers again
    world.host.allowReply("open_session")
    const mark = world.host.commands.length
    const restarted = world.connect(parent.sessionId, lane.options)
    await restarted.lifecycle.reconcileOnSessionStart(parent.sessionId)

    // then
    expect(restarted.store.load(child.task_id)?.status).toBe("cancelled")
    expect(restarted.manager.getResidentHandle(child.task_id)).toBeUndefined()
    expect(world.host.commands.slice(mark).map((command) => command.type)).not.toContain("prompt")
    expect(hostHolds(world, child)).toBe(false)
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
  })

  test("#given a pending cancel #when the task is interrupted or cancelled again before the stop lands #then neither overrides it: the run ends cancelled, once", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    await cancelUnreachable(lane, child)

    // when
    const interrupted = await bounded(parent.manager.interruptTask(child.task_id), "task interrupt")
    const again = await bounded(runTaskCancel(parent.manager, { task_id: child.task_id }), "the second task_cancel")
    const pendingView = await runTaskOutput({ manager: parent.manager, stateDir: parent.store.stateDir }, { task_id: child.task_id }, parent.sessionId)

    // then - still pending, still running
    expect(interrupted.kind).toBe("noop")
    expect(again.details).toMatchObject({ kind: "cancel_pending", task_id: child.task_id })
    expect(pendingView.details).toMatchObject({ kind: "status", snapshot: { status: "running" } })
    expect(pendingView.details.kind === "status" ? pendingView.details.snapshot.stop : undefined).toBeDefined()

    // when - the transport recovers
    world.host.allowReply("open_session")
    const closed = world.host.waitForCommand("close_session")
    world.host.cutConnections()
    await bounded(closed, "the stop on the host")
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")

    // then
    expect(stopped.status).toBe("cancelled")
    expect(world.commandsOfType("close_session")).toBe(1)
    const finalView = await runTaskOutput({ manager: parent.manager, stateDir: parent.store.stateDir }, { task_id: child.task_id }, parent.sessionId)
    expect(finalView.details.kind === "status" ? finalView.details.snapshot.stop : "no status view").toBeUndefined()
  })

  test("#given a pending cancel whose cancelled-record write does not land while its teardown lets the handle go #when the stop lands #then the run still ends cancelled and the next child takes the lane", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(2)
    const child = recordAt(parent, 0)
    await cancelUnreachable(lane, child)
    const transition = parent.store.transition.bind(parent.store)
    let skipped = false
    spyOn(parent.store, "transition").mockImplementation((taskId: string, next: TaskTransition) => {
      if (!skipped && taskId === child.task_id && next.type === "cancel") {
        skipped = true
        const current = parent.store.load(taskId)
        if (current === null) throw new Error("the cancelled child's record is missing")
        // The write did not land: the store answers as if the record were left as it was.
        return { ...transitionTaskRecord(current, next), applied: false, record: current }
      }
      return transition(taskId, next)
    })

    // when - the transport recovers and the stop runs on the host
    world.host.allowReply("open_session")
    const nextPrompt = world.host.waitForCommand("prompt")
    world.host.cutConnections()
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")

    // then
    expect(skipped).toBe(true)
    expect(stopped.status).toBe("cancelled")
    expect(String((await bounded(nextPrompt, "the next child's prompt")).payload.message)).toBe("host child parent-a #1")
    expect(concurrencyOf(parent).getCount(HOST_CHILD_MODEL)).toBe(1)
  })

  test("#given a pending cancel left by a parent that shut down #when its next session starts but the host does not confirm the session closed #then the child is neither revived nor marked cancelled while its session runs, and the next start finishes the cancel", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    await cancelUnreachable(lane, child)
    await parent.lifecycle.suspendOnSessionShutdown({ parentSessionId: parent.sessionId, reason: "session_shutdown" })

    // when - the host answers again but never answers the close
    world.host.allowReply("open_session")
    world.host.withholdReply("close_session")
    const mark = world.host.commands.length
    const restarted = world.connect(parent.sessionId, { ...lane.options, hostCloseTimeoutMs: 50 })
    await restarted.lifecycle.reconcileOnSessionStart(parent.sessionId)

    // then - the cancel is still pending: not running again, not falsely cancelled
    expect(restarted.store.load(child.task_id)).toMatchObject({ status: "running" })
    expect(restarted.store.load(child.task_id)?.cancel_requested).toBeDefined()
    expect(world.host.commands.slice(mark).map((command) => command.type)).not.toContain("prompt")
    expect(hostHolds(world, child)).toBe(true)

    // when - the next session start, with the host answering the close
    world.host.allowReply("close_session")
    const again = world.connect(parent.sessionId, { ...lane.options, hostCloseTimeoutMs: 50 })
    await again.lifecycle.reconcileOnSessionStart(parent.sessionId)

    // then
    expect(again.store.load(child.task_id)?.status).toBe("cancelled")
    expect(hostHolds(world, child)).toBe(false)
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
  })

  test("#given a pending cancel left by a parent that shut down #when its next session starts while the host answers but cannot list its sessions #then the cancel stays pending instead of finishing with the session still running, and the next start finishes it (#9450)", async () => {
    // given
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    await cancelUnreachable(lane, child)
    await parent.lifecycle.suspendOnSessionShutdown({ parentSessionId: parent.sessionId, reason: "session_shutdown" })

    // when - the host answers its protocol probe but refuses list_sessions, as an overloaded shard does
    world.host.allowReply("open_session")
    world.host.failReply("list_sessions", "host busy")
    const restarted = world.connect(parent.sessionId, { ...lane.options, productionProbe: true, hostCloseTimeoutMs: 50 })
    await restarted.lifecycle.reconcileOnSessionStart(parent.sessionId)

    // then - "could not ask" is not "nothing is live": the cancel is still pending and the session still held
    expect(restarted.store.load(child.task_id)?.status).not.toBe("cancelled")
    expect(restarted.store.load(child.task_id)?.cancel_requested).toBeDefined()
    expect(hostHolds(world, child)).toBe(true)

    // when - the next session start, with the host listing again
    world.host.failReply("list_sessions", undefined)
    const again = world.connect(parent.sessionId, { ...lane.options, productionProbe: true, hostCloseTimeoutMs: 50 })
    await again.lifecycle.reconcileOnSessionStart(parent.sessionId)

    // then
    expect(again.store.load(child.task_id)?.status).toBe("cancelled")
    expect(hostHolds(world, child)).toBe(false)
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
  })

  test("#given a child whose transport recovery is reading the reattached session's state #when task_cancel lands during that read #then the turn is never continued and the session ends on the host", async () => {
    // given - a reattach that gets the connection back but holds its state read
    const lane = await startCancelLane(worlds, 1)
    const { world, parent } = lane
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const session = sessionOf(world, child)
    world.host.withholdReply("get_state")
    const stateAsked = world.host.waitForCommand("get_state")
    const promptsBefore = world.commandsOfType("prompt")
    world.host.cutConnections()
    await bounded(stateAsked, "the reattach's state read")

    // when - the cancel lands during the read, then the host answers state reads again
    const cancelled = await bounded(runTaskCancel(parent.manager, { task_id: child.task_id }), "task_cancel")
    world.host.allowReply("get_state")
    world.host.cutConnections()
    const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")

    // then
    expect(["cancel_pending", "cancelled"]).toContain(cancelled.details.kind)
    expect(stopped.status).toBe("cancelled")
    expect(world.commandsOfType("prompt")).toBe(promptsBefore)
    // The record turns cancelled as the stop lands; the host drops the session as its close completes.
    // Wait for that end on the host instead of racing it.
    await bounded(session.processExit ?? Promise.resolve(), "the cancelled child's process exit")
    expect(hostHolds(world, child)).toBe(false)
  })
})
