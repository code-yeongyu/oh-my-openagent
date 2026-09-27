import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "./create"
import { cleanupProjects, FakeRegistry, seedRecord, settings, tempStore } from "./__fixtures__/lifecycle-fakes"

afterEach(cleanupProjects)

const PID = 4_242

function orphanLifecycle(initiallyAlive: boolean, status: "error" | "lost" = "error") {
  const store = tempStore()
  const state = { alive: initiallyAlive }
  const signals: string[] = []
  seedRecord(store, {
    task_id: "st_0000dead",
    status,
    residency_state: "resident",
    execution_mode: "process",
    pid: PID,
    host_pid: process.pid,
    updated_at: "1970-01-01T00:00:00.000Z",
    notified_epoch: 0,
  })
  const lifecycle = createTaskLifecycle({
    store,
    registry: new FakeRegistry(),
    config: settings({ ttl_ms: 1 }),
    now: () => 10_000,
    orphanKillDelayMs: 0,
    signaller: {
      isAlive: (candidate) => candidate === PID && state.alive,
      signal: (candidate, signal) => {
        signals.push(`${signal}:${candidate}`)
        state.alive = false
      },
    },
  })
  return { store, state, signals, lifecycle }
}

describe("an orphan pid the destruction port has handled is consumed", () => {
  for (const initiallyAlive of [true, false]) {
    test(`#given an orphan whose pid was ${initiallyAlive ? "alive and signalled" : "already dead"} #when the OS reuses that pid before the TTL sweep #then the sweep signals nothing`, async () => {
      const { store, state, signals, lifecycle } = orphanLifecycle(initiallyAlive)

      await lifecycle.destroyResidentTask("st_0000dead", "reconcile_lost")
      const afterOrphan = [...signals]
      state.alive = true
      await lifecycle.cleanupExpiredRecords()

      expect(afterOrphan).toEqual(initiallyAlive ? [`SIGTERM:${PID}`] : [])
      expect(signals).toEqual(afterOrphan)
      expect(store.load("st_0000dead")).toBeNull()
      lifecycle.dispose?.()
    })
  }
})

describe("a lost record keeps its pid-dead proof", () => {
  test("#given a lost orphan that was signalled #when its process is gone at the TTL sweep #then the record is expunged without a second signal", async () => {
    const { store, signals, lifecycle } = orphanLifecycle(true, "lost")

    await lifecycle.destroyResidentTask("st_0000dead", "reconcile_lost")
    await lifecycle.cleanupExpiredRecords()

    expect(signals).toEqual([`SIGTERM:${PID}`])
    expect(store.load("st_0000dead")).toBeNull()
    lifecycle.dispose?.()
  })

  test("#given a lost orphan that was signalled #when the OS reuses its pid before the TTL sweep #then the record is retained and nothing is signalled", async () => {
    const { store, state, signals, lifecycle } = orphanLifecycle(true, "lost")

    await lifecycle.destroyResidentTask("st_0000dead", "reconcile_lost")
    state.alive = true
    await lifecycle.cleanupExpiredRecords()

    expect(signals).toEqual([`SIGTERM:${PID}`])
    expect(store.load("st_0000dead")?.status).toBe("lost")
    lifecycle.dispose?.()
  })
})
