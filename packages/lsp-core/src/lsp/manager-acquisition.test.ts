import { describe, expect, it } from "bun:test"

import { afterMicrotasks, gatedManager, MICROTASK_SWEEP, pool, SERVER, settle } from "./manager-test-support.js"

describe("LspManager acquisition becomes a reference atomically", () => {
  it("#given a resident idle client at the cap #when it is re-acquired and another root is admitted before that acquisition resumes #then the caller gets the pooled running client with its reference", async () => {
    // given
    const { manager, clients } = gatedManager({ maxResidentClients: 1 })
    try {
      const first = await manager.getClient("/root-a", SERVER)
      manager.releaseClient("/root-a", SERVER, first)

      // when: the admission of root-b runs synchronously right after the resident hit on root-a
      const again = manager.getClient("/root-a", SERVER)
      const other = manager.getClient("/root-b", SERVER)
      const [a, b] = await Promise.all([again, other])

      // then
      expect(a).toBe(first)
      expect(clients[0]?.running()).toBe(true)
      expect(pool(manager)).toEqual([
        ["/root-a", 1, 0, false],
        ["/root-b", 1, 0, false],
      ])
      manager.releaseClient("/root-a", SERVER, a)
      manager.releaseClient("/root-b", SERVER, b)
      expect(pool(manager).map(([, refs, waiters]) => refs + waiters)).toEqual([0, 0])
    } finally {
      await manager.stopAll()
    }
  })

  it("#given two waiters on one cold start #when one aborts at any point while the start finishes #then the survivor gets the pooled running client with one reference and the start is not stopped", async () => {
    const outcomes = []
    for (const abortingFirst of [true, false]) {
      for (const turns of MICROTASK_SWEEP) {
        // given
        const { manager, clients } = gatedManager({ holdStart: (index) => index === 0 })
        const controller = new AbortController()
        const aborting = () => settle(manager.getClient("/root", SERVER, controller.signal))
        const surviving = () => settle(manager.getClient("/root", SERVER, new AbortController().signal))
        const survivorFirst = abortingFirst ? undefined : surviving()
        const abortingWaiter = aborting()
        const survivor = survivorFirst ?? surviving()

        // when
        clients[0]?.started.open()
        await afterMicrotasks(turns, () => controller.abort())
        const [left, kept] = await Promise.all([abortingWaiter, survivor])

        // then
        const holders = [left, kept].filter((outcome) => outcome.value !== undefined).length
        outcomes.push({
          abortingFirst,
          turns,
          survivorGotPooledRunningClient: kept.value === clients[0] && clients[0]?.running() === true,
          poolMatchesHolders: JSON.stringify(pool(manager)) === JSON.stringify([["/root", holders, 0, false]]),
        })
        for (let held = 0; held < holders; held += 1) manager.releaseClient("/root", SERVER, clients[0])
        await manager.stopAll()
      }
    }
    expect(
      outcomes.filter((outcome) => !outcome.survivorGotPooledRunningClient || !outcome.poolMatchesHolders),
    ).toEqual([])
  })

  it("#given a waiter on a cold start at the cap #when another root is admitted at any point while the start finishes #then the waiter gets the pooled running client", async () => {
    const outcomes = []
    for (const turns of MICROTASK_SWEEP) {
      // given
      const { manager, clients } = gatedManager({ maxResidentClients: 1, holdStart: (index) => index === 0 })
      const waiter = settle(manager.getClient("/root-a", SERVER))
      let other: ReturnType<typeof settle> | undefined

      // when
      clients[0]?.started.open()
      await afterMicrotasks(turns, () => {
        other = settle(manager.getClient("/root-b", SERVER))
      })
      const got = await waiter
      await other

      // then
      outcomes.push({
        turns,
        gotPooledRunningClient: got.value === clients[0] && clients[0]?.running() === true,
        referenced: pool(manager).find(([root]) => root === "/root-a")?.[1] ?? 0,
      })
      await manager.stopAll()
    }
    expect(outcomes.filter((outcome) => !outcome.gotPooledRunningClient || outcome.referenced !== 1)).toEqual([])
  })

  it("#given a holder whose client was invalidated and replaced #when it releases the client it held #then the replacement keeps its holder's reference", async () => {
    // given
    const { manager } = gatedManager()
    try {
      const stale = await manager.getClient("/root", SERVER)
      manager.invalidateClient("/root", SERVER, stale)
      const replacement = await manager.getClient("/root", SERVER)

      // when
      manager.releaseClient("/root", SERVER, stale)

      // then
      expect(replacement).not.toBe(stale)
      expect(pool(manager)).toEqual([["/root", 1, 0, false]])
      manager.releaseClient("/root", SERVER, replacement)
      expect(pool(manager)).toEqual([["/root", 0, 0, false]])
    } finally {
      await manager.stopAll()
    }
  })
})
