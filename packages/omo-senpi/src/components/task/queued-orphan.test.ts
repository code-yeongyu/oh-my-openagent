import { afterEach, expect, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { coldReviveHarness } from "../../../../senpi-task/src/lifecycle/__fixtures__/cold-revive-harness"
import { createTaskLifecycle } from "../../../../senpi-task/src/lifecycle/create"
import { NO_HOST_ENDPOINT } from "../../../../senpi-task/src/lifecycle/host-session"
import { cleanupProjects, settings } from "../../../../senpi-task/src/manager/__fixtures__/manager-fakes"

afterEach(cleanupProjects)

for (const revivable of [true, false]) {
  test(`queued reconcile_lost kills the orphan before ${revivable ? "parking its transcript" : "dropping the missing target"}`, async () => {
    const h = coldReviveHarness()
    const order: string[] = []
    let alive = true
    const append = h.store.appendEvent.bind(h.store)
    spyOn(h.store, "appendEvent").mockImplementation((id, event) => {
      if (event.type === "steer_dropped") order.push("drop")
      return append(id, event)
    })
    const lifecycle = createTaskLifecycle({
      hostEndpoint: NO_HOST_ENDPOINT, store: h.store, registry: h.registry, config: settings(),
      orphanKillDelayMs: 0,
      signaller: {
        isAlive: pid => pid === 3333 && alive,
        signal: (pid, signal) => { order.push(`${signal}:${pid}`); alive = false },
      },
      idleReclaimerScheduler: { setInterval: () => ({}), clearInterval: () => undefined },
    })
    try {
      h.store.mutate(h.record.task_id, record => ({
        ...record, execution_mode: "process", pid: 3333,
        pending_steering: [{ id: "orphan-1", message: "Q1", deliver_as: "steer" }],
      }))
      if (!revivable) rmSync(h.sessionPath)

      await lifecycle.destroyResidentTask(h.record.task_id, "reconcile_lost")

      expect(alive).toBe(false)
      expect(order).toEqual(revivable ? ["SIGTERM:3333"] : ["SIGTERM:3333", "drop"])
      expect(h.store.load(h.record.task_id)?.pid).toBeUndefined()
      if (revivable) {
        expect(h.store.load(h.record.task_id)?.residency_state).toBe("rpc_detached")
        expect(h.store.load(h.record.task_id)?.pending_steering?.map(entry => entry.message)).toEqual(["Q1"])
      } else {
        expect(h.store.load(h.record.task_id)?.pending_steering).toBeUndefined()
      }
    } finally {
      lifecycle.dispose?.()
      h.lifecycle.dispose?.()
    }
  })
}
