/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { InboxLeaseOwnership } from "./lease-ownership"

function createSignal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolveSignal: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolveSignal = resolve
  })

  if (resolveSignal === undefined) {
    throw new Error("signal resolver was not initialized")
  }

  return { promise, resolve: resolveSignal }
}

describe("InboxLeaseOwnership", () => {
  test("#given an admitted child still runs w2tc #when ownership closes #then drain waits for the child and rejects late admission", async () => {
    // given
    const ownership = new InboxLeaseOwnership()
    const childEntered = createSignal()
    const releaseChild = createSignal()
    const events: string[] = []
    const child = ownership.tryRun(async () => {
      events.push("child-entered")
      childEntered.resolve()
      await releaseChild.promise
      events.push("child-finished")
    })
    await childEntered.promise

    // when
    const drained = ownership.closeAndDrain().then(() => events.push("drained"))
    events.push("closed")
    const lateRun = ownership.tryRun(async () => events.push("late-ran"))
    releaseChild.resolve()
    await Promise.all([child, drained])

    // then
    expect(lateRun).toBeNull()
    expect(events).toEqual(["child-entered", "closed", "child-finished", "drained"])
  })

  test("#given separate inbox ownerships w2tc #when one has an active child #then the other drains independently", async () => {
    // given
    const ownershipA = new InboxLeaseOwnership()
    const ownershipB = new InboxLeaseOwnership()
    const childAEntered = createSignal()
    const releaseChildA = createSignal()
    const events: string[] = []
    const childA = ownershipA.tryRun(async () => {
      childAEntered.resolve()
      await releaseChildA.promise
      events.push("a-child-finished")
    })
    await childAEntered.promise

    // when
    const drainedA = ownershipA.closeAndDrain().then(() => events.push("a-drained"))
    await ownershipB.closeAndDrain()
    events.push("b-drained")
    releaseChildA.resolve()
    await Promise.all([childA, drainedA])

    // then
    expect(events).toEqual(["b-drained", "a-child-finished", "a-drained"])
  })

  test("#given an admitted child remains active after close w2tc #when it starts a descendant #then the descendant stays reentrant", async () => {
    // given
    const ownership = new InboxLeaseOwnership()
    const childEntered = createSignal()
    const startDescendant = createSignal()
    const events: string[] = []
    const child = ownership.tryRun(async () => {
      childEntered.resolve()
      await startDescendant.promise
      const descendant = ownership.tryRun(async () => {
        events.push("descendant-finished")
      }, true)
      await descendant
      events.push("child-finished")
    })
    await childEntered.promise

    // when
    const drained = ownership.closeAndDrain().then(() => events.push("drained"))
    startDescendant.resolve()
    await Promise.all([child, drained])

    // then
    expect(events).toEqual(["descendant-finished", "child-finished", "drained"])
  })

  test("#given an admitted child throws w2tc #when ownership closes #then failure still releases the drain", async () => {
    // given
    const ownership = new InboxLeaseOwnership()
    const childEntered = createSignal()
    const releaseChild = createSignal()
    const events: string[] = []
    const childFailure = new Error("expected child failure")
    const child = ownership.tryRun(async () => {
      childEntered.resolve()
      await releaseChild.promise
      events.push("child-threw")
      throw childFailure
    })
    const observedChild = child?.catch((error: unknown) => {
      events.push("child-cleaned")
      return error
    })
    await childEntered.promise

    // when
    const drained = ownership.closeAndDrain().then(() => events.push("drained"))
    releaseChild.resolve()
    const observedError = await observedChild
    await drained

    // then
    expect(observedError).toBe(childFailure)
    expect(events).toEqual(["child-threw", "child-cleaned", "drained"])
  })
})
