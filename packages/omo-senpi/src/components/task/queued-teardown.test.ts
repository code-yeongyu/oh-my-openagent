import { afterEach, expect, spyOn, test } from "bun:test"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"

afterEach(cleanupProjects)

for (const path of ["LRU eviction", "interrupted idle reclaim", "completion", "revive_failure"] as const) {
  test(`${path} parks its queued continuation and revival delivers it first in order`, async () => {
    let now = 1000
    const h = coldReviveHarness({ cap: 1, idleTimeoutMs: 37, now: () => now })
    const pending = ["Q1", "Q2"].map((message, index) => ({
      id: `queued-${index}`, message, deliver_as: "steer" as const,
    }))
    const events = spyOn(h.store, "appendEvent")
    try {
      expect((await h.send()).kind).toBe("revived")
      h.store.mutate(h.record.task_id, record => ({ ...record, pending_steering: pending }))
      const terminal = h.manager.waitFor(h.record.task_id, { signal: AbortSignal.timeout(5000) })
      if (path === "interrupted idle reclaim") await h.manager.interruptTask(h.record.task_id)
      h.fake.settle({ status: "completed", finalResponse: "DONE" })
      await terminal
      if (path === "LRU eviction") {
        expect((await h.lifecycle.admitResident("parent")).kind).toBe("evicted")
      } else if (path === "interrupted idle reclaim" || path === "completion") {
        now += 37
        expect(await h.lifecycle.reclaimIdleResidents?.()).toEqual([h.record.task_id])
      } else {
        await h.lifecycle.destroyResidentTask(h.record.task_id, path)
      }
      expect(h.manager.getResidentHandle(h.record.task_id)).toBeUndefined()
      expect(h.manager.residentTaskIds()).toEqual([])
      expect(h.store.load(h.record.task_id)?.residency_state).toBe("persisted_only")
      expect(h.store.load(h.record.task_id)?.pending_steering).toEqual(pending)
      expect((await h.send("USER_NEXT")).kind).toBe("revived")
      expect(h.fake.followUpCalls.at(-1)).toBe("Q1\n\nQ2\n\nUSER_NEXT")
      expect(h.store.load(h.record.task_id)?.pending_steering).toBeUndefined()
      expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped")).toEqual([])
    } finally {
      await h.dispose()
    }
  })
}

test("before TTL a parked queue's next revival delivers the entries in order", async () => {
  const h = coldReviveHarness({ ttlMs: 200, now: () => 1100 })
  const pending = ["Q1", "Q2"].map((message, index) => ({
    id: `ttl-${index}`, message, deliver_as: "steer" as const,
  }))
  try {
    h.store.mutate(h.record.task_id, record => ({
      ...record, updated_at: new Date(1000).toISOString(), terminal_at: new Date(1000).toISOString(), pending_steering: pending,
    }))
    const swept = await h.lifecycle.cleanupExpiredRecords()
    expect(swept.retained).toContain(h.record.task_id)
    expect(swept.deleted).not.toContain(h.record.task_id)
    expect(h.store.load(h.record.task_id)?.pending_steering).toEqual(pending)
    expect((await h.send("USER_NEXT")).kind).toBe("revived")
    expect(h.fake.followUpCalls).toEqual(["Q1\n\nQ2\n\nUSER_NEXT"])
    expect(h.store.load(h.record.task_id)?.pending_steering).toBeUndefined()
  } finally {
    await h.dispose()
  }
})
