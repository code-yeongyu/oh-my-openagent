import { afterEach, describe, expect, test } from "bun:test"
import { cleanupProjects as cleanupManagers } from "../manager/__fixtures__/manager-fakes"
import { hostSession } from "./__fixtures__/host-session-fakes"
import { cleanupProjects, readEvents, seedRecord } from "./__fixtures__/lifecycle-fakes"
import { bounded, liveParentFixture, signal } from "./__fixtures__/live-parent-fakes"
import { resolveContext } from "./context"
import { expireSuspendedChild } from "./suspended-expiry"

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

describe("live-parent recovery review guards (#9799)", () => {
  for (const shutdown of ["budget", "claim"] as const) {
    test(`#given parent shutdown during ${shutdown} #when expiry runs #then the child stays parked`, async () => {
      const f = fixture()
      const id = await f.start()
      const attempted = f.wait("live_parent_recovery_attempt")
      f.park(id)
      await attempted
      const quit = () =>
        f.lifecycle.suspendOnSessionShutdown({
          parentSessionId: "parent-1",
          reason: "quit",
        })
      let quitting: ReturnType<typeof quit> | undefined
      if (shutdown === "budget") await quit()
      else
        f.beforeNextMutation(() => {
          quitting = quit()
        })
      f.advance(300_000)
      if (quitting !== undefined) await quitting
      expect(f.store.load(id)?.killed).not.toBe(true)
      expect(f.store.load(id)?.status).toBe("running")
      expect(f.store.load(id)?.residency_state).toBe("rpc_detached")
      expect(readEvents(f.store, id)).not.toContain("live_parent_expiry_claimed")
      expect(f.terminals).toHaveLength(0)
      expect(f.messages).toHaveLength(0)
    })
  }

  test("#given shutdown after an expiry claim #when close settles #then one result is buffered", async () => {
    const f = fixture("host-session")
    const id = await f.start()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await attempted
    const gate = f.holdClose()
    f.state.closeRefused = false
    const ended = f.wait("suspended_unresumable")
    f.advance(300_000)
    await bounded(gate.started)
    f.parent.value = { kind: "session_shutdown" }
    f.dispose()
    gate.resolve()
    await ended
    expect(f.terminals).toHaveLength(1)
    expect(f.messages).toHaveLength(0)
    expect(f.notifier.bufferedCount("parent-1")).toBe(1)
    f.parent.value = { kind: "idle" }
    f.notifier.flushBuffered({ sessionId: "parent-1", replaced: false })
    f.notifier.flushBuffered({ sessionId: "parent-1", replaced: false })
    expect(f.messages).toHaveLength(1)
  })

  test("#given an unconfirmed local stop #when retry ticks advance #then attempts back off without new claims", async () => {
    const f = fixture("child-process")
    f.dispose()
    const id = await f.start()
    f.state.stopConfirmed = false
    f.park(id)
    const context = resolveContext(f.deps)
    const expire = async () => {
      const record = f.store.load(id)
      if (record === null) throw new Error("missing expiry fixture")
      await expireSuspendedChild(context, record, () => true)
    }
    await expire()
    expect(f.signals).toHaveLength(2)
    const claim = f.store.load(id)?.residency_claim
    for (const delay of [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 300_000]) {
      const before = f.signals.length
      f.advance(delay - 1)
      await expire()
      expect(f.signals).toHaveLength(before)
      f.advance(1)
      await expire()
      expect(f.signals).toHaveLength(before + 2)
      expect(f.store.load(id)?.residency_claim).toBe(claim)
    }
    expect(readEvents(f.store, id).filter((event) => event === "live_parent_expiry_claimed")).toHaveLength(1)
    expect(f.terminals).toHaveLength(0)
    expect(f.messages).toHaveLength(0)
    f.state.stopConfirmed = true
    f.advance(300_000)
    await expire()
    expect(f.store.load(id)?.status).toBe("error")
    expect(f.terminals).toHaveLength(1)
    expect(f.messages).toHaveLength(1)
  })

  test("#given a replacement residency claim during close #when revival continues #then it never respawns", async () => {
    const f = fixture()
    const id = await f.start()
    f.state.revivable = true
    f.state.closeRefused = false
    f.store.mutate(id, (record) => ({
      ...record,
      fallback_closing_child: {
        host_session: hostSession(id),
        requires_confirmation: true,
      },
    }))
    const gate = f.holdClose()
    const attempted = f.wait("live_parent_recovery_attempt")
    f.park(id)
    await bounded(gate.started)
    f.store.mutate(id, (record) => ({
      ...record,
      residency_claim: "replacement-owner",
    }))
    gate.resolve()
    await attempted
    expect(f.state.respawns).toBe(0)
    expect(f.store.load(id)?.residency_claim).toBe("replacement-owner")
    expect(f.terminals).toHaveLength(0)
    expect(f.messages).toHaveLength(0)
  })

  for (const field of ["socket", "instance_id", "routing_id"] as const) {
    test(`#given a replacement closing ${field} #when a late close settles #then it retains the replacement`, async () => {
      const f = fixture("host-session")
      const id = await f.start()
      const attempted = f.wait("live_parent_recovery_attempt")
      f.park(id)
      await attempted
      const gate = f.holdClose()
      f.state.closeRefused = false
      const ended = f.wait("suspended_unresumable")
      f.advance(300_000)
      await bounded(gate.started)
      f.advance(10_000)
      await ended
      const previous = f.store.load(id)?.fallback_closing_child
      if (previous?.host_session === undefined) throw new Error("missing closing identity")
      const replacement = {
        ...previous,
        host_session: {
          ...previous.host_session,
          [field]: `replacement-${field}`,
        },
      }
      f.store.mutate(id, (record) => ({
        ...record,
        fallback_closing_child: replacement,
      }))
      const settled = signal<void>()
      f.beforeNextMutation(() => settled.resolve())
      gate.resolve()
      await bounded(settled.promise)
      expect(f.store.load(id)?.fallback_closing_child).toEqual(replacement)
      expect(f.terminals).toHaveLength(1)
      expect(f.messages).toHaveLength(1)
    })
  }

  test("#given hung own and foreign obligations #when session starts and cleans up #then neither blocks or duplicates closes", async () => {
    const f = fixture("host-session")
    for (const [taskId, parent] of [
      ["st_00000081", "parent-1"],
      ["st_00000082", "other-parent"],
    ]) {
      if (taskId === undefined || parent === undefined) throw new Error("invalid fixture")
      const record = seedRecord(f.backing, {
        task_id: taskId,
        parent_session_id: parent,
        status: "error",
        residency_state: "disposed",
        execution_mode: "process",
        killed: true,
        run_epoch: 0,
        notified_epoch: 0,
        updated_at: "2025-01-01T00:00:00.000Z",
      })
      f.backing.mutate(taskId, (fresh) => ({
        ...fresh,
        fallback_closing_child: {
          host_session: hostSession(record.task_id),
          requires_confirmation: true,
        },
      }))
    }
    const gate = f.holdClose()
    f.state.closeRefused = false
    const start = f.lifecycle.reconcileOnSessionStart("parent-1")
    try {
      await bounded(start)
      await bounded(f.lifecycle.cleanupExpiredRecords())
      expect(f.state.closes).toBe(1)
      f.advance(10_000)
      for (let pass = 0; pass < 3; pass += 1) {
        await bounded(f.lifecycle.reconcileOnSessionStart("parent-1"))
        await bounded(f.lifecycle.cleanupExpiredRecords())
      }
      expect(f.state.closes).toBe(1)
      expect(f.store.load("st_00000082")?.fallback_closing_child).toBeDefined()
    } finally {
      const cleared = f.until(() => f.store.load("st_00000081")?.fallback_closing_child === undefined)
      gate.resolve()
      await start
      await cleared
    }
  })
})
