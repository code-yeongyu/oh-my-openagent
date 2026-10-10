import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { cleanupProjects } from "./__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture } from "./__fixtures__/live-parent-fakes"

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

describe("live-parent suspended child recovery (#9350)", () => {
  test("revives immediately through scoped admission without a terminal result", async () => {
    const f = fixture()
    const id = await f.start()
    f.state.revivable = true
    const recovered = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await recovered
    expect(f.store.load(id)?.residency_state).toBe("resident")
    expect(f.manager.getResidentHandle(id)).toBeDefined()
    expect(f.messages).toHaveLength(0)
  })

  for (const mode of ["in-process", "child-process"] as const) {
    test(`${mode} reaches a confirmed terminal after the suspension budget`, async () => {
      const f = fixture(mode)
      const id = await f.start()
      const attempted = f.wait("live_parent_recovery_attempt")
      f.park(id)
      await attempted
      const terminal = f.manager.waitFor(id)
      const ended = f.wait("suspended_unresumable")
      f.advance(300_000)
      await ended
      expect(f.store.load(id)?.status).toBe("error")
      expect(f.store.load(id)?.residency_state).toBe("disposed")
      expect(f.messages).toHaveLength(1)
      expect((await bounded(terminal)).status).toBe("error")
      expect(f.messages[0]?.content).not.toContain("may still be running")
      if (mode === "child-process") {
        expect(f.signals).toEqual([42424])
        expect(f.alivePids.size).toBe(0)
      }
      const next = await f.start()
      expect(f.store.load(next)?.status).toBe("running")
    })
  }

  test("unreachable daemon fails once with a durable close obligation and duplicate-work caveat", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    f.host.daemon.alive = false
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    const record = f.store.load(id)
    expect(record?.status).toBe("error")
    expect(record?.error_message).toStartWith("suspended_unresumable:")
    expect(record?.fallback_closing_child?.host_session).toEqual(record?.host_session)
    expect(record?.residency_state).toBe("disposed")
    expect(f.messages).toHaveLength(1)
    expect(f.messages[0]?.content).toContain("may still be running")
    expect(f.messages[0]?.content).toContain("at-most-once")
    expect(f.messages[0]?.content).toContain("side-effecting")
    const next = await f.start()
    expect(f.store.load(next)?.status).toBe("running")
  })

  test("closure retries survive restart and confirmed closure never repeats the parent result", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    const first = f.state.closes
    const retried = f.nextClose()
    f.advance(600_000)
    await retried
    await f.lifecycle.cleanupExpiredRecords()
    expect(f.state.closes).toBeGreaterThan(first)
    expect(f.store.load(id)?.fallback_closing_child).toBeDefined()
    const lifecycle = f.restart()
    f.state.closeRefused = false
    const cleared = f.until(() => f.store.load(id)?.fallback_closing_child === undefined)
    await lifecycle.reconcileOnSessionStart("parent-1")
    await lifecycle.cleanupExpiredRecords()
    await cleared
    expect(f.store.load(id)?.fallback_closing_child).toBeUndefined()
    expect(f.store.load(id)?.status).toBe("error")
    f.notifier.reconcileUnnotifiedNotifications({
      sessionId: "parent-1",
      parentState: { kind: "idle" },
    })
    expect(f.messages).toHaveLength(1)
    expect(f.terminals).toHaveLength(1)
  })

  test("timed-out daemon close retries and its late confirmation only clears the obligation", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    f.store.mutate(id, (record) => ({
      ...record,
      final_response: "partial work retained",
    }))
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const gate = f.holdClose()
    f.state.closeRefused = false
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await gate.started
    f.advance(10_000)
    await ended
    expect(f.messages).toHaveLength(1)
    expect(f.messages[0]?.content).toContain("may still be running")
    expect(f.messages[0]?.content).toContain("partial work retained")
    expect(f.store.load(id)?.fallback_closing_child).toBeDefined()
    const cleared = f.until(() => f.store.load(id)?.fallback_closing_child === undefined)
    gate.resolve()
    await cleared
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.messages).toHaveLength(1)
  })

  test("a suspended pending child fails and leaves the concurrency queue", async () => {
    const f = fixture()
    await f.start()
    const id = await f.start()
    expect(f.store.load(id)?.status).toBe("pending")
    const attempted = f.wait("live_parent_recovery_attempt")
    f.store.transition(id, {
      type: "persist_only",
      timestamp: new Date().toISOString(),
    })
    await attempted
    const terminal = f.manager.waitFor(id)
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await ended
    expect((await bounded(terminal)).status).toBe("error")
    expect(f.manager.concurrency).toBeDefined()
    expect(f.manager.concurrency?.queuePosition("anthropic/claude", id)).toBeUndefined()
    expect(f.messages).toHaveLength(1)
  })

  test("a revival claim that wins before threshold cannot also fail", async () => {
    const f = fixture()
    const id = await f.start()
    const gate = f.holdRevival()
    f.state.revivable = true
    const started = f.wait("live_parent_recovery_started")
    f.park(id)
    await started
    const attempted = f.wait("live_parent_recovery_attempt")
    f.advance(300_000)
    gate.resolve()
    await attempted
    expect(f.store.load(id)?.status).toBe("running")
    expect(f.store.load(id)?.residency_state).toBe("resident")
    expect(f.messages).toHaveLength(0)
  })

  test("a threshold claim that wins before revival cannot resurrect", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const gate = f.holdClose()
    f.state.closeRefused = false
    const claimed = f.wait("live_parent_expiry_claimed")
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await claimed
    f.state.revivable = true
    await f.lifecycle.reconcileOnSessionStart("parent-1")
    gate.resolve()
    await ended
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.manager.getResidentHandle(id)).toBeUndefined()
    expect(f.messages).toHaveLength(1)
  })

  test("absent parent stays parked and ordinary session_start revival still works", async () => {
    const f = fixture()
    const id = await f.start()
    f.state.live = false
    f.state.revivable = true
    f.park(id)
    f.advance(300_000)
    await Promise.resolve()
    expect(f.state.respawns).toBe(0)
    expect(f.timers.size).toBe(1)
    expect(f.store.load(id)?.residency_state).toBe("rpc_detached")
    expect(f.messages).toHaveLength(0)
    f.state.live = true
    await f.lifecycle.reconcileOnSessionStart("parent-1")
    expect(f.store.load(id)?.residency_state).toBe("resident")
  })

  test("finished idle-evicted child is untouched and not reported again", async () => {
    const f = fixture()
    const id = await f.start()
    f.store.transition(id, {
      type: "complete",
      timestamp: new Date().toISOString(),
      final_response: "done",
    })
    const previousMessages = f.messages.length
    f.park(id)
    f.advance(300_000)
    await Promise.resolve()
    expect(f.store.load(id)?.status).toBe("completed")
    expect(f.state.respawns).toBe(0)
    expect(f.timers.size).toBe(1)
    expect(f.messages).toHaveLength(previousMessages)
    expect(f.terminals).toHaveLength(1)
  })
})
