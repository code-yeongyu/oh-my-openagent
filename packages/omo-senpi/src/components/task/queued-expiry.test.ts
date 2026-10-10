import { afterEach, expect, spyOn, test } from "bun:test"
import { createCompletionNotifier } from "../../../../senpi-task/src/completion/notifier"
import type { ParentNotifierMessage } from "../../../../senpi-task/src/completion/types"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createCompletionObservingStore } from "./completion-bridge"

afterEach(cleanupProjects)

for (const residency of ["persisted_only", "rpc_detached"] as const) {
  test(`TTL ends a running queued ${residency} child through suspended expiry exactly once`, async () => {
    // Given a running suspended child whose queued message outlives the TTL.
    let now = 1000
    const messages: ParentNotifierMessage[] = []
    const h = coldReviveHarness({
      ttlMs: 37, now: () => now,
      storeWrapper: backing => createCompletionObservingStore(backing, {
        notifier: createCompletionNotifier({ store: backing, notifier: { enqueue: message => messages.push(message) } }),
        parentState: () => ({ kind: "idle" }), wasBackground: () => true, currentSessionId: () => "parent",
      }),
    })
    const events = spyOn(h.store, "appendEvent")
    h.store.mutate(h.record.task_id, record => {
      const { final_response: _previousTurn, terminal_at: _previousTerminal, ...running } = record
      return {
        ...running, status: "running", residency_state: residency, notify_on_terminal: true,
        execution_mode: residency === "rpc_detached" ? "process" : "in-process",
        updated_at: new Date(now).toISOString(),
        pending_steering: [{ id: "expired", message: "Q1", deliver_as: "steer" }],
      }
    })
    try {
      // When the TTL sweep crosses the horizon on the injected clock.
      now += 37
      await h.lifecycle.cleanupExpiredRecords()

      // Then expiry publishes one failure, including the queue count, without a lost intermediate.
      const ended = h.store.load(h.record.task_id)
      expect(ended?.status).toBe("error")
      expect(ended?.failure_kind).toBe("suspended_unresumable")
      expect(ended?.pending_steering).toBeUndefined()
      expect(ended?.killed).toBe(true)
      expect(ended?.notification.run_epoch).toBe(h.record.notification.run_epoch)
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toContain("1 queued message was not delivered.")
      expect(events.mock.calls.filter(([, event]) => event.type === "suspended_unresumable").map(([, event]) => event.payload))
        .toEqual([{ cause: "parent session restarted", confirmed_stop: true, undelivered_messages: 1 }])
      expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped").map(([, event]) => event.payload))
        .toEqual([{ count: 1, reason: "target_gone" }])
      now += 37
      expect((await h.lifecycle.cleanupExpiredRecords()).deleted).toContain(h.record.task_id)
      expect(messages).toHaveLength(1)
    } finally {
      h.lifecycle.dispose?.()
    }
  })
}

for (const expiry of ["target_gone", "ttl"] as const) {
  for (const notified of [false, true]) {
    test(`${expiry} ends a terminal queued target and reports it once after prior notification=${notified}`, async () => {
      let now = 1000
      const messages: ParentNotifierMessage[] = []
      const h = coldReviveHarness({
        ttlMs: 37, now: () => now,
        storeWrapper: backing => {
          const notifier = createCompletionNotifier({ store: backing, notifier: { enqueue: message => messages.push(message) } })
          return createCompletionObservingStore(backing, {
            notifier, parentState: () => ({ kind: "idle" }), wasBackground: () => true, currentSessionId: () => "parent",
          })
        },
      })
      const events = spyOn(h.store, "appendEvent")
      try {
        h.store.mutate(h.record.task_id, record => ({
          ...record, updated_at: new Date(now).toISOString(), terminal_at: new Date(now).toISOString(),
          notification: { ...record.notification, notified_epoch: notified ? record.notification.run_epoch : -1 },
          pending_steering: [{ id: "expired", message: "Q1", deliver_as: "steer" }],
        }))
        now += 37

        if (expiry === "ttl") await h.lifecycle.cleanupExpiredRecords()
        else await h.lifecycle.destroyResidentTask(h.record.task_id, "target_gone")

        const ended = h.store.load(h.record.task_id)
        expect(ended?.status).toBe("error")
        expect(ended?.notification.run_epoch).toBe(h.record.notification.run_epoch + 1)
        expect(ended?.pending_steering).toBeUndefined()
        expect(ended?.killed).toBe(true)
        expect(messages).toHaveLength(1)
        expect(messages[0]?.content).toContain(ended?.error_message ?? "missing drop notice")
        expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped").map(([, event]) => event.payload))
          .toEqual([{ count: 1, reason: "target_gone" }])
        expect((await h.send()).kind).toBe("not_continuable")
        now += 37
        const swept = await h.lifecycle.cleanupExpiredRecords()
        expect(swept.deleted).toContain(h.record.task_id)
        expect(messages).toHaveLength(1)
      } finally {
        h.lifecycle.dispose?.()
      }
    })
  }
}
