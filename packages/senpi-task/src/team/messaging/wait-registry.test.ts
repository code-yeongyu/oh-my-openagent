import { describe, expect, test } from "bun:test"

import { WaitRegistry } from "./wait-registry"

type TestMessage = {
  readonly id: string
  readonly from: string
}

describe("WaitRegistry", () => {
  test("#given mixed sender filters w2mem #when messages are claimed #then matching waiters are taken FIFO", async () => {
    // given
    const registry = new WaitRegistry<TestMessage>()
    const first = registry.register()
    const aliceOnly = registry.register({ from: "alice" })
    const third = registry.register()

    // when
    const firstClaim = registry.takeMatch({ id: "m1", from: "alice" })
    const secondClaim = registry.takeMatch({ id: "m2", from: "bob" })
    const thirdClaim = registry.takeMatch({ id: "m3", from: "alice" })

    // then
    expect(firstClaim?.message.id).toBe("m1")
    expect(secondClaim?.message.id).toBe("m2")
    expect(thirdClaim?.message.id).toBe("m3")
    expect(firstClaim?.resolve()).toBe(true)
    expect(secondClaim?.resolve()).toBe(true)
    expect(thirdClaim?.resolve()).toBe(true)
    await expect(first.promise).resolves.toEqual({ id: "m1", from: "alice" })
    await expect(third.promise).resolves.toEqual({ id: "m2", from: "bob" })
    await expect(aliceOnly.promise).resolves.toEqual({ id: "m3", from: "alice" })
    expect(registry.size).toBe(0)
  })
  test("#given waits for independent team runs w2mem #when a team message is claimed #then it cannot consume another team's wait", async () => {
    // given
    const registry = new WaitRegistry<TestMessage>()
    const teamA = registry.register("team-a")
    const teamB = registry.register("team-b")

    // when
    const claim = registry.takeMatch("team-b", { id: "m1", from: "alice" })

    // then
    expect(claim?.message.id).toBe("m1")
    expect(claim?.resolve()).toBe(true)
    await expect(teamB.promise).resolves.toEqual({ id: "m1", from: "alice" })
    expect(teamA.cancel()).toBe(true)
  })


  test("#given cancelled and claimed waits w2mem #when cleanup runs #then cancelled waits never match and abandoned claims rejoin FIFO", async () => {
    // given
    const registry = new WaitRegistry<TestMessage>()
    const cancelled = registry.register({ from: "alice" })
    const first = registry.register()
    const second = registry.register()
    expect(cancelled.cancel()).toBe(true)

    // when
    const claim = registry.takeMatch({ id: "m1", from: "alice" })
    expect(claim?.abandon()).toBe(true)
    const reclaimed = registry.takeMatch({ id: "m2", from: "bob" })
    const remaining = registry.takeMatch({ id: "m3", from: "bob" })

    // then
    expect(reclaimed?.resolve()).toBe(true)
    expect(remaining?.resolve()).toBe(true)
    await expect(first.promise).resolves.toEqual({ id: "m2", from: "bob" })
    await expect(second.promise).resolves.toEqual({ id: "m3", from: "bob" })
    expect(registry.takeMatch({ id: "m4", from: "alice" })).toBeUndefined()
    expect(registry.size).toBe(0)
  })

  test("#given parked waits w2mem #when cancelAll runs #then every promise rejects and the registry is empty", async () => {
    // given
    const registry = new WaitRegistry<TestMessage>()
    const first = registry.register()
    const second = registry.register({ from: "alice" })
    const reason = new Error("session shutdown")

    // when
    registry.cancelAll(reason)

    // then
    await expect(first.promise).rejects.toBe(reason)
    await expect(second.promise).rejects.toBe(reason)
    expect(registry.size).toBe(0)
  })
})
