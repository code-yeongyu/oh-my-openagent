import { afterEach, expect, test } from "bun:test"

import { createTaskLifecycle } from "../lifecycle/create"
import { FakeRegistry } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { DEFAULT_HOST_SESSION_RETRY_POLICY, NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import { cleanupProjects, makeHandle, settings } from "./__fixtures__/manager-fakes"
import { exitedTask } from "./__fixtures__/provisional-exit"

afterEach(cleanupProjects)

test.each(["resident", "rpc_detached"])("same-session deferred retry loses a provisional exit instead of reviving it (%s)", async (residency) => {
  // Given a provisional exit whose dying owner still appears alive to the first reconcile.
  const f = await exitedTask()
  const ownerPid = f.store.load(f.taskId)?.host_pid
  if (ownerPid === undefined) throw new Error("missing owner")
  const alive = new Set([ownerPid])
  const retry = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const settled = Promise.withResolvers<void>()
  let respawns = 0
  const lifecycle = createTaskLifecycle({
    store: {
      ...f.store,
      appendEvent: (id, event) => {
        const result = f.store.appendEvent(id, event)
        if (event.type === "destroyed") settled.resolve()
        return result
      },
    },
    registry: new FakeRegistry(), config: settings({ reattach_on_reconcile: true }),
    hostPid: process.pid + 100000, hostEndpoint: NO_HOST_ENDPOINT,
    signaller: { isAlive: (pid) => alive.has(pid), signal: () => {} },
    hostRetry: {
      ...DEFAULT_HOST_SESSION_RETRY_POLICY, deferredRetryBackoffMs: [1],
      wait: () => { entered.resolve(); return retry.promise },
    },
    respawn: async (record) => {
      respawns += 1
      settled.resolve()
      return { ok: true, handle: makeHandle(record.task_id, 901).handle }
    },
    reattach: async () => ({ ok: true }),
  })
  try {
    const initial = await lifecycle.reconcileOnSessionStart("parent-1")
    expect(initial.outcomes[0]?.kind).toBe("deferred")
    await entered.promise
    // When only the already-enrolled scoped retry sees the owner finally disappear.
    if (residency === "rpc_detached") {
      f.store.transition(f.taskId, { type: "detach_rpc", timestamp: new Date(f.clock.now()).toISOString() })
    }
    f.manager.forget(f.taskId, { path: "park" })
    alive.delete(ownerPid)
    retry.resolve()
    await settled.promise
    // Then it must take the provisional-to-LOST path, never resume the transcript.
    expect(f.store.load(f.taskId)?.status).toBe("lost")
    expect(f.events()).toContain("reconcile_lost")
    expect(respawns).toBe(0)
  } finally {
    lifecycle.dispose?.()
    retry.resolve()
    f.dispose()
  }
})
