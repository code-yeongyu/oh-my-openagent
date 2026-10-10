import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"
import { liveParentFixture } from "./__fixtures__/live-parent-fakes"
import { TRANSCRIPT_ASSISTANT_EVENT } from "../manager/transcript-log"
import { rmSync } from "node:fs"
import { join } from "node:path"

const fixtures: ReturnType<typeof liveParentFixture>[] = []
function fixture(mode?: Parameters<typeof liveParentFixture>[0]) {
  const f = liveParentFixture(mode)
  fixtures.push(f)
  return f
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.dispose()
  cleanupProjects()
  cleanupManagers()
})

describe("parked recovery contract (#9861)", () => {
  test("the initial parent-restart revival cannot hide an in-flight run from its deadline", async () => {
    const f = fixture()
    const id = await f.start()
    await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
    f.restart()
    const gate = f.holdRevival()
    f.state.revivable = true
    const reconcile = f.lifecycle.reconcileOnSessionStart("parent-1")
    await gate.started
    expect(f.store.load(id)?.recovery_deadline_at).toBeDefined()
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    gate.resolve()
    await reconcile
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.manager.getResidentHandle(id)).toBeUndefined()
    expect(f.messages).toHaveLength(1)
  })

  for (const missing of ["transcript", "launch-spec"] as const) {
    test(`a running child missing its ${missing} ends without replaying the original prompt`, async () => {
      const f = fixture()
      const id = await f.start()
      f.state.revivable = true
      if (missing === "transcript") rmSync(join(f.store.stateDir, "children", id), { recursive: true, force: true })
      else f.store.mutate(id, (record) => {
        const { spawn_spec: _spec, ...rest } = record
        return rest
      })
      const ended = f.wait("suspended_unresumable")
      f.park(id)
      await ended
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.state.respawns).toBe(0)
      expect(f.messages).toHaveLength(1)
    })
  }
  test("the terminal result retains the last output and transcript tail once", async () => {
    const f = fixture()
    const id = await f.start()
    f.store.mutate(id, (record) => ({ ...record, final_response: "saved partial output" }))
    f.store.appendEvent(id, { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "transcript evidence before parking" } })
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    expect(f.messages).toHaveLength(1)
    expect(f.messages[0]?.content).toContain("saved partial output")
    expect(f.messages[0]?.content).toContain("transcript evidence before parking")
    expect(f.store.load(id)?.final_response).toBe("saved partial output")
  })

  test("a parked record with a live foreign owner still ends at its deadline", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    f.manager.forget(id)
    f.alivePids.add(55555)
    f.store.mutate(id, (record) => ({ ...record, residency_state: "rpc_detached", host_pid: 55555 }))
    const armed = f.until(() => f.store.load(id)?.recovery_deadline_at !== undefined)
    await armed
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.messages).toHaveLength(1)
    expect(f.signals).toEqual([])
    expect(f.state.respawns).toBe(0)
  })
  test("a second parent restart cannot renew the parked child's deadline", async () => {
    const f = fixture()
    const id = await f.start()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const deadline = f.store.load(id)?.recovery_deadline_at
    expect(deadline).toBeDefined()
    await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
    f.restart()
    f.advance(300_000)
    f.state.revivable = true
    await f.lifecycle.reconcileOnSessionStart("parent-1")
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.store.load(id)?.recovery_deadline_at).toBe(deadline)
    expect(f.manager.getResidentHandle(id)).toBeUndefined()
    expect(f.messages).toHaveLength(1)
    await f.lifecycle.reconcileOnSessionStart("parent-1")
    expect(f.messages).toHaveLength(1)
  })

  test("a shutdown park without a reason resumes automatically after parent restart", async () => {
    const f = fixture()
    const id = await f.start()
    await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "parent-1", reason: "quit" })
    expect(f.store.load(id)?.suspension_reason).toBeUndefined()
    expect(f.manager.concurrency?.leaseState(id, 0)).not.toBe("held")
    f.restart()
    f.state.revivable = true
    await f.lifecycle.reconcileOnSessionStart("parent-1")
    expect(f.store.load(id)?.residency_state).toBe("resident")
    expect(f.manager.getResidentHandle(id)).toBeDefined()
    const ended = f.until(() => f.store.load(id)?.status === "completed")
    f.resumedHandles.get(id)?.settle({ status: "completed", finalResponse: "recovered work" })
    await ended
    expect(f.messages).toHaveLength(1)
    expect(f.messages[0]?.content).toContain("recovered work")
  })

  for (const reason of ["host_draining", "host_unreachable"] as const) {
    test(`${reason} is retried and ends once by the existing budget`, async () => {
      const f = fixture("host-session")
      const id = await f.start()
      if (reason === "host_unreachable") f.host.daemon.alive = false
      else f.state.failureCode = "host_draining"
      const attempted = f.wait("live_parent_recovery_attempt")
      f.park(id)
      await attempted
      const retried = f.wait("live_parent_recovery_attempt")
      f.advance(5_000)
      await retried
      const ended = f.wait("suspended_unresumable")
      f.advance(295_000)
      await ended
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.store.load(id)?.error_message).toContain(reason)
      expect(f.store.load(id)?.fallback_closing_child?.requires_confirmation).toBe(true)
      expect(f.messages).toHaveLength(1)
      expect(f.messages[0]?.content).toContain("may still be running")
    })
  }

  for (const reason of ["host_incompatible", "spawn_spec_unavailable", "session_unavailable"] as const) {
    test(`permanent ${reason} ends without advancing the clock`, async () => {
      const f = fixture("host-session")
      const id = await f.start()
      f.state.failureCode = reason
      f.state.permanentFailure = true
      const ended = f.wait("suspended_unresumable")
      f.park(id)
      await ended
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.store.load(id)?.error_message).toContain(reason)
      expect(f.messages).toHaveLength(1)
      expect(f.state.respawns).toBe(1)
    })
  }

  for (const residency of ["evicted", "disposed"] as const) {
    test(`an unfinished ${residency} legacy record also gets a bounded recovery`, async () => {
      const f = fixture()
      const id = await f.start()
      f.manager.forget(id)
      const attempted = f.wait("live_parent_recovery_attempt")
      f.store.mutate(id, (record) => ({ ...record, residency_state: residency }))
      await attempted
      const ended = f.wait("suspended_unresumable")
      f.advance(300_000)
      await ended
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.messages).toHaveLength(1)
    })
  }

  test("a steer while host draining survives until the automatically revived handle receives it", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    f.state.failureCode = "host_draining"
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const epoch = f.store.load(id)?.notification.run_epoch
    expect(epoch).toBeDefined()
    expect(f.manager.concurrency?.leaseState(id, epoch ?? -1)).not.toBe("held")
    const sent = await f.manager.sendToTask({ idOrName: id, message: "continue with the corrected scope", deliverAs: "steer" })
    expect(sent.kind).toBe("queued")
    f.state.revivable = true
    const delivered = f.wait("steered")
    f.advance(5_000)
    await delivered
    expect(f.resumedHandles.get(id)?.steerCalls).toEqual(["continue with the corrected scope"])
    expect(f.store.load(id)?.pending_steering).toBeUndefined()
  })
})
