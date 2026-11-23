import { describe, expect, it } from "bun:test"

import {
  afterMicrotasks,
  gatedManager,
  IDLE_TIMEOUT_MS,
  INIT_TIMEOUT_MS,
  MICROTASK_SWEEP,
  pool,
  REAPER_INTERVAL_MS,
  SERVER,
  settle,
} from "./manager-test-support.js"

const PAST_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS + REAPER_INTERVAL_MS

describe("LspManager reaping and shutdown never hand out a stopped client", () => {
  it("#given a waiter on a cold start #when the idle reaper runs at any point while the start finishes #then the waiter gets the pooled running client, which is reaped only once released and idle", async () => {
    const outcomes = []
    for (const turns of MICROTASK_SWEEP) {
      // given
      const { manager, clients, clock } = gatedManager({ holdStart: (index) => index === 0 })
      const waiter = settle(manager.getClient("/root", SERVER))

      // when
      clients[0]?.started.open()
      await afterMicrotasks(turns, () => clock.advanceBy(PAST_IDLE_TIMEOUT_MS))
      const got = await waiter
      const gotPooledRunningClient = got.value === clients[0] && clients[0]?.running() === true
      clock.advanceBy(PAST_IDLE_TIMEOUT_MS)
      const keptWhileReferenced = pool(manager)
      manager.releaseClient("/root", SERVER, clients[0])
      clock.advanceBy(PAST_IDLE_TIMEOUT_MS)

      // then
      outcomes.push({
        turns,
        gotPooledRunningClient,
        keptWhileReferenced: JSON.stringify(keptWhileReferenced) === JSON.stringify([["/root", 1, 0, false]]),
        reapedOnceIdle: manager.clientCount() === 0 && clients[0]?.stopCount === 1,
      })
      await manager.stopAll()
    }
    expect(
      outcomes.filter((row) => !row.gotPooledRunningClient || !row.keptWhileReferenced || !row.reapedOnceIdle),
    ).toEqual([])
  })

  it("#given a start the init-timeout reaper stopped while its stop is pending #when that start still resolves #then its waiter acquires a fresh client after the stop instead of the stopped one", async () => {
    // given
    const { manager, clients, clock } = gatedManager({ holdStart: (index) => index === 0, holdStops: true })
    try {
      const waiter = settle(manager.getClient("/root", SERVER))
      clock.advanceBy(INIT_TIMEOUT_MS + REAPER_INTERVAL_MS)
      expect(clients[0]?.stopCount).toBe(1)
      expect(manager.clientCount()).toBe(0)

      // when
      clients[0]?.started.open()
      clients[0]?.stopped.open()
      const got = await waiter

      // then
      expect(clients).toHaveLength(2)
      expect(got.value).toBe(clients[1])
      expect(clients[1]?.running()).toBe(true)
      expect(pool(manager)).toEqual([["/root", 1, 0, false]])
      manager.releaseClient("/root", SERVER, clients[1])
    } finally {
      for (const client of clients) client.stopped.open()
      await manager.stopAll()
    }
  })

  it("#given a waiter on a cold start #when stopAll runs and then the start resolves #then the waiter rejects instead of getting the stopped client", async () => {
    // given
    const { manager, clients } = gatedManager({ holdStart: (index) => index === 0, holdStops: true })
    const waiter = settle(manager.getClient("/root", SERVER))

    // when
    const stopping = manager.stopAll()
    clients[0]?.started.open()
    const got = await waiter
    clients[0]?.stopped.open()
    await stopping

    // then
    expect(got.value).toBeUndefined()
    expect(String(got.error)).toContain("LspManager has been disposed")
    expect(clients[0]?.stopCount).toBe(1)
    expect(manager.clientCount()).toBe(0)
  })

  it("#given a warmup start joined by a waiter #when the waiter aborts at any point while the start finishes #then the warmup client keeps running in the pool", async () => {
    const outcomes = []
    for (const turns of MICROTASK_SWEEP) {
      // given
      const { manager, clients } = gatedManager({ holdStart: (index) => index === 0 })
      manager.warmupClient("/root", SERVER)
      const controller = new AbortController()
      const joiner = settle(manager.getClient("/root", SERVER, controller.signal))

      // when
      clients[0]?.started.open()
      await afterMicrotasks(turns, () => controller.abort())
      const got = await joiner

      // then
      const holders = got.value === undefined ? 0 : 1
      outcomes.push({
        turns,
        warmupRunning: clients[0]?.running() === true,
        poolMatchesHolders: JSON.stringify(pool(manager)) === JSON.stringify([["/root", holders, 0, false]]),
      })
      await manager.stopAll()
    }
    expect(outcomes.filter((row) => !row.warmupRunning || !row.poolMatchesHolders)).toEqual([])
  })
})
