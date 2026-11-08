import { afterEach, expect, spyOn, test } from "bun:test"
import { createCompletionNotifier } from "../../../../senpi-task/src/completion/notifier"
import type { ParentNotifierMessage } from "../../../../senpi-task/src/completion/types"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { hostLifecycleDeps } from "../../../../senpi-task/src/lifecycle/__fixtures__/host-session-fakes"
import { resolveContext } from "../../../../senpi-task/src/lifecycle/context"
import { retryDeferredScopedChild } from "../../../../senpi-task/src/lifecycle/deferred-revival"
import { cleanupProjects } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"
import { createCompletionObservingStore } from "./completion-bridge"

afterEach(cleanupProjects)

for (const owned of [false, true]) {
  test(`queued deferred exhaustion ${owned ? "leaves the owning session's deadline intact" : "ends lost with one count-bearing completion"}`, async () => {
    // Given a suspended running child, with a queue and a retryable model refusal.
    let now = 1_000
    const messages: ParentNotifierMessage[] = []
    const h = coldReviveHarness({
      now: () => now,
      storeWrapper: backing => createCompletionObservingStore(backing, {
        notifier: createCompletionNotifier({ store: backing, notifier: { enqueue: message => messages.push(message) } }),
        parentState: () => ({ kind: "idle" }), wasBackground: () => true, currentSessionId: () => "parent",
      }),
    })
    const events = spyOn(h.store, "appendEvent")
    h.store.mutate(h.record.task_id, record => {
      const { final_response: _previousTurn, ...running } = record
      return {
        ...running, status: "running", notify_on_terminal: true,
        pending_steering: [{ id: "queued", message: "Q1", deliver_as: "steer" }],
      }
    })
    const host = hostLifecycleDeps({
      store: h.store, hostPid: process.pid, now: () => now,
      deferredRetryBackoffMs: [10, 20, 40], onWait: ms => { now += ms },
      respawn: async () => ({ ok: false, disposition: "retryable", code: "model_unavailable", reason: "model unavailable" }),
    })
    const context = resolveContext({
      ...host.deps, registry: { ...h.registry, ownsRecord: () => owned },
    })
    try {
      // When the real deferred-revival loop spends its entire fake-clock retry ladder.
      await retryDeferredScopedChild(context, h.record.task_id, "parent", "model_unavailable")

      // Then only a non-owned record ends; the live owner retains its own expiry obligation.
      const ended = h.store.load(h.record.task_id)
      expect(host.waits).toEqual([10, 20, 40])
      expect(events.mock.calls.filter(([, event]) => event.type === "revival_retry_exhausted")).toHaveLength(1)
      expect(ended?.status).toBe(owned ? "running" : "lost")
      if (owned) {
        expect(ended?.pending_steering).toHaveLength(1)
        expect(messages).toHaveLength(0)
        expect(events.mock.calls.filter(([, event]) => event.type === "reconcile_lost")).toHaveLength(0)
      } else {
        expect(ended?.pending_steering).toBeUndefined()
        expect(ended?.error_message).toContain("1 queued message was not delivered.")
        expect(messages).toHaveLength(1)
        expect(messages[0]?.content).toContain("1 queued message was not delivered.")
        expect(events.mock.calls.filter(([, event]) => event.type === "steer_dropped").map(([, event]) => event.payload))
          .toEqual([{ count: 1, reason: "target_gone" }])
      }
    } finally {
      h.lifecycle.dispose?.()
    }
  })
}
