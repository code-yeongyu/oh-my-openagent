import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { runTaskCancel } from "../tools/control/cancel"
import { bounded, hostHolds, recordAt, sessionOf, startCancelLane } from "./rpc-host/__fixtures__/cancel-lane"
import type { FakeHostSession } from "./rpc-host/__fixtures__/fake-host"
import type { HostWorld } from "./rpc-host/__fixtures__/host-world"
import { HostSessionClient, type OpenedHostSession } from "./rpc-host/session-client"

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

describe("cancellation while transport recovery reads state", () => {
  test("#given a held recovery state read #when cancellation closes the original process before a late reopen #then the late process also ends without continuing the turn", async () => {
    const { world, parent } = await startCancelLane(worlds, 1)
    await parent.startChildren(1)
    const child = recordAt(parent, 0)
    const original = sessionOf(world, child)
    if (original.processExit === undefined) throw new Error("the fixture did not start a session process")
    world.host.withholdReply("get_state")
    const stateAsked = world.host.waitForCommand("get_state")
    const promptsBefore = world.commandsOfType("prompt")
    world.host.cutConnections()
    await bounded(stateAsked, "the reattach's state read")

    const cancelled = await bounded(runTaskCancel(parent.manager, { task_id: child.task_id }), "task_cancel")
    const resumeOpen = Promise.withResolvers<void>()
    const openStarted = Promise.withResolvers<void>()
    const lateSession = Promise.withResolvers<{ readonly session: FakeHostSession; readonly attached: boolean }>()
    const pendingOpens: Promise<OpenedHostSession>[] = []
    const open = HostSessionClient.prototype.open
    let gated = false
    const openSpy = spyOn(HostSessionClient.prototype, "open").mockImplementation(function (this: HostSessionClient, input) {
      // Hold only this child's recovery; the non-retained cancellation channel still closes it.
      if (gated || this.socketPath !== world.host.socketPath || input.sessionPath !== original.sessionPath || !input.retainOnDisconnect) return open.call(this, input)
      gated = true
      const pending = (async () => {
        await resumeOpen.promise
        const opened = await open.call(this, input)
        lateSession.resolve({ session: sessionOf(world, child), attached: opened.attached })
        return opened
      })()
      pendingOpens.push(pending)
      void pending.catch(lateSession.reject)
      openStarted.resolve()
      return pending
    })

    try {
      world.host.allowReply("get_state")
      world.host.cutConnections()
      await bounded(openStarted.promise, "the late recovery open")
      const stopped = await bounded(parent.manager.waitFor(child.task_id), "the cancelled record")
      await bounded(original.processExit, "the original process exit")
      expect(hostHolds(world, child)).toBe(false)

      resumeOpen.resolve()
      const reopened = await bounded(lateSession.promise, "the reopened session")
      expect(reopened.attached).toBe(false)
      if (reopened.session.processPid === undefined || reopened.session.processExit === undefined) throw new Error("the late reopen did not start a session process")
      await bounded(reopened.session.processExit, "the late reopened process exit")

      expect(["cancel_pending", "cancelled"]).toContain(cancelled.details.kind)
      expect(stopped.status).toBe("cancelled")
      expect(parent.store.load(child.task_id)?.status).toBe("cancelled")
      expect(world.commandsOfType("prompt")).toBe(promptsBefore)
      expect(hostHolds(world, child)).toBe(false)
    } finally {
      resumeOpen.resolve()
      await Promise.allSettled(pendingOpens)
      openSpy.mockRestore()
    }
  })
})
