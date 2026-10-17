import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, FakeRegistry, readEvents, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"
import { createTaskLifecycle } from "./create"
import { DEFAULT_HOST_SESSION_RETRY_POLICY, NO_HOST_ENDPOINT } from "./host-session"
import type { TaskRecordStore } from "../store"

afterEach(cleanupProjects)

function fixture(startupBackoffMs: readonly number[] = []) {
  const store = tempStore()
  const taskId = "st_97150001"
  const ownerPid = 7101
  const alive = new Set([ownerPid])
  const waits: Array<ReturnType<typeof Promise.withResolvers<void>>> = []
  const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const
  const destroyed = Promise.withResolvers<void>()
  let beforeClaim: (() => void) | undefined
  const observedStore: TaskRecordStore = {
    ...store,
    mutate: (id, mutation) => {
      beforeClaim?.()
      beforeClaim = undefined
      return store.mutate(id, mutation)
    },
    appendEvent: (id, event) => {
      const result = store.appendEvent(id, event)
      if (id === taskId && event.type === "destroyed") destroyed.resolve()
      return result
    },
  }
  seedRecord(store, {
    task_id: taskId, parent_session_id: "old-parent", status: "pending",
    execution_mode: "process", host_pid: ownerPid, pid: 7102,
  })
  store.transition(taskId, { type: "start", timestamp: new Date().toISOString() })
  const signals: number[] = []
  const lifecycle = createTaskLifecycle({
    store: observedStore, registry: new FakeRegistry(),
    config: settings({ reattach_on_reconcile: false }),
    hostPid: 7201, hostEndpoint: NO_HOST_ENDPOINT,
    signaller: { isAlive: (pid) => alive.has(pid), signal: (pid) => { signals.push(pid); alive.delete(pid) } },
    hostRetry: {
      ...DEFAULT_HOST_SESSION_RETRY_POLICY,
      daemonLossBackoffMs: startupBackoffMs,
      deferredRetryBackoffMs: [1, 2],
      wait: () => {
        const gate = Promise.withResolvers<void>()
        waits.push(gate)
        entered[waits.length - 1]?.resolve()
        return gate.promise
      },
    },
  })
  return {
    store, taskId, ownerPid, alive, waits, entered, destroyed, signals, lifecycle,
    beforeClaim: (callback: () => void) => { beforeClaim = callback },
  }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("reconcile event missing")), 1_000) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe("deferred foreign owner reconciliation (omo#9715)", () => {
  test("startup observes dead-child recovery before a one-response parent can exit", async () => {
    // Given a dead child whose owner is still visible during startup.
    const f = fixture([1, 2])
    const order: string[] = []
    const destroyed = f.destroyed.promise.then(() => { order.push("destroyed") })
    try {
      const startup = f.lifecycle.reconcileOnSessionStart("new-parent").then((result) => {
        order.push("startup_returned")
        return result
      })
      await bounded(f.entered[0].promise)
      // When owner death is confirmed during the bounded startup retry.
      f.alive.delete(f.ownerPid)
      f.waits[0]?.resolve()
      const result = await bounded(startup)
      await bounded(destroyed)
      // Then the startup caller cannot exit with only the old deferred outcome.
      expect(order).toEqual(["destroyed", "startup_returned"])
      expect(result.outcomes[0]?.kind).toBe("lost")
      expect(f.store.load(f.taskId)?.status).toBe("lost")
    } finally {
      f.lifecycle.dispose?.()
      for (const wait of f.waits) wait.resolve()
    }
  })

  for (const session of [undefined, "new-parent"]) {
    test(`a tree-killed child reaches lost after its still-visible owner exits (${session ?? "global"})`, async () => {
      // Given: the child is dead but the tree killer has not finished releasing its owner.
      const f = fixture()
      try {
        const initial = await f.lifecycle.reconcileOnSessionStart(session)
        expect(initial.outcomes[0]?.kind).toBe(session === undefined ? "foreign_live_owner" : "deferred")
        expect(f.store.load(f.taskId)?.status).toBe("running")
        expect(f.waits).toHaveLength(1)
        // When: the first retry still sees the owner; the next sees confirmed death.
        f.waits[0]?.resolve()
        await bounded(f.entered[1].promise)
        expect(f.store.load(f.taskId)?.host_pid).toBe(f.ownerPid)
        expect(readEvents(f.store, f.taskId)).toEqual(["transition_applied"])
        f.alive.delete(f.ownerPid)
        f.waits[1]?.resolve()
        await bounded(f.destroyed.promise)
        // Then: no second session_start is needed and no dead process is signalled.
        expect(f.store.load(f.taskId)?.status).toBe("lost")
        expect(readEvents(f.store, f.taskId)).toContain("reconcile_lost")
        expect(f.signals).toEqual([])
      } finally {
        f.lifecycle.dispose?.()
        for (const wait of f.waits) wait.resolve()
      }
    })
  }

  test("a live sibling owner is never lost when the retry budget ends", async () => {
    // Given a live owner throughout both attempts.
    const f = fixture()
    try {
      await f.lifecycle.reconcileOnSessionStart("new-parent")
      expect(f.waits).toHaveLength(1)
      // When every bounded attempt sees the live owner.
      f.waits[0]?.resolve()
      await bounded(f.entered[1].promise)
      f.waits[1]?.resolve()
      // A direct pass also observes the unchanged owner; it cannot steal its task.
      await f.lifecycle.reconcileOnSessionStart("new-parent")
      // Then the record and process remain owned by the sibling.
      expect(f.store.load(f.taskId)?.status).toBe("running")
      expect(f.store.load(f.taskId)?.host_pid).toBe(f.ownerPid)
      expect(readEvents(f.store, f.taskId)).toEqual(["transition_applied"])
      expect(f.signals).toEqual([])
    } finally {
      f.lifecycle.dispose?.()
      for (const wait of f.waits) wait.resolve()
    }
  })

  for (const stop of ["dispose", "shutdown"] as const) {
    test(`a deferred retry cannot reclaim after ${stop}`, async () => {
      // Given a deferred retry whose owning session is about to stop.
      const f = fixture()
      try {
        await f.lifecycle.reconcileOnSessionStart("new-parent")
        expect(f.waits).toHaveLength(1)
        // When the observer stops before owner death is released to the retry.
        if (stop === "dispose") f.lifecycle.dispose?.()
        else await f.lifecycle.suspendOnSessionShutdown({ parentSessionId: "new-parent", reason: "quit" })
        f.alive.delete(f.ownerPid)
        f.waits[0]?.resolve()
        await f.waits[0]?.promise
        // Then the stopped observer makes no record mutation.
        expect(f.store.load(f.taskId)?.status).toBe("running")
        expect(readEvents(f.store, f.taskId)).toEqual(["transition_applied"])
      } finally {
        f.lifecycle.dispose?.()
        for (const wait of f.waits) wait.resolve()
      }
    })
  }

  test("an owner alive again at the locked claim is not stolen", async () => {
    // Given a dead-owner probe followed by a live PID before the claim.
    const f = fixture()
    try {
      await f.lifecycle.reconcileOnSessionStart("new-parent")
      expect(f.waits).toHaveLength(1)
      f.alive.delete(f.ownerPid)
      f.beforeClaim(() => f.alive.add(f.ownerPid))
      // When the retry attempts to claim, the locked liveness check refuses.
      f.waits[0]?.resolve()
      await bounded(Promise.race([f.entered[1].promise, f.destroyed.promise]))
      expect(f.store.load(f.taskId)?.status).toBe("running")
      expect(f.store.load(f.taskId)?.host_pid).toBe(f.ownerPid)
      expect(readEvents(f.store, f.taskId)).toEqual(["transition_applied"])
      // Then a subsequent confirmed death can still settle the deferred task.
      f.alive.delete(f.ownerPid)
      f.waits[1]?.resolve()
      await bounded(f.destroyed.promise)
      expect(f.store.load(f.taskId)?.status).toBe("lost")
    } finally {
      f.lifecycle.dispose?.()
      for (const wait of f.waits) wait.resolve()
    }
  })

  test("a genuine error written at the claim boundary remains error", async () => {
    // Given the old manager's independent failure racing the retry's stale running snapshot.
    const f = fixture()
    try {
      await f.lifecycle.reconcileOnSessionStart("new-parent")
      expect(f.waits).toHaveLength(1)
      f.alive.delete(f.ownerPid)
      f.beforeClaim(() => f.store.transition(f.taskId, {
        type: "fail", timestamp: "2030-01-01T00:00:00.000Z", error_message: "independent crash",
      }))
      // When the locked claim re-reads the now-terminal record, its old snapshot loses.
      f.waits[0]?.resolve()
      await bounded(f.entered[1].promise)
      f.waits[1]?.resolve()
      await f.waits[1]?.promise
      // Then neither the retry nor reconciliation relabels the failure.
      expect(f.store.load(f.taskId)?.status).toBe("error")
      expect(f.store.load(f.taskId)?.error_message).toBe("independent crash")
      expect(readEvents(f.store, f.taskId)).not.toContain("reconcile_lost")
    } finally {
      f.lifecycle.dispose?.()
      for (const wait of f.waits) wait.resolve()
    }
  })

  test("a live replacement owner keeps its claim", async () => {
    // Given a new owner claiming while the retry is deferred.
    const f = fixture()
    try {
      await f.lifecycle.reconcileOnSessionStart("new-parent")
      expect(f.waits).toHaveLength(1)
      f.alive.delete(f.ownerPid)
      f.alive.add(7301)
      f.store.mutate(f.taskId, (record) => ({ ...record, host_pid: 7301, residency_claim: "new-claim" }))
      // When the stale retry wakes, ownership no longer matches its observed claim.
      f.waits[0]?.resolve()
      await f.waits[0]?.promise
      // Then no process or record belonging to the replacement is touched.
      expect(f.store.load(f.taskId)?.host_pid).toBe(7301)
      expect(f.store.load(f.taskId)?.status).toBe("running")
      expect(f.signals).toEqual([])
    } finally {
      f.lifecycle.dispose?.()
      for (const wait of f.waits) wait.resolve()
    }
  })
})
