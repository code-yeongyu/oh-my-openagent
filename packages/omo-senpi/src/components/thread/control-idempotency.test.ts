import { afterEach, describe, expect, test } from "bun:test"

import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #14951 finding 2 (pins: "a repeat of close/interrupt under one key"): a control call repeated under its idempotency key
// answers the first outcome and performs no second effect, on every surface, because the key is honoured in the core
// and not in a surface. The thread tool already did; the thread SDK closed and interrupted twice.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const interruptsOn = (sent: readonly { rpc?: Record<string, unknown> }[]) =>
  sent.filter((entry) => entry.rpc?.["type"] === "interrupt").length

describe("the idempotency key on a thread SDK control call", () => {
  test("#given a close on this device whose answer the caller lost #when the caller repeats it under the same key #then the holder closes once and the repeat answers the first outcome", async () => {
    const s = surface(account().remote)
    const sdk = s.sdk()
    const first = await sdk.close({ thread: "dur-local", idempotency_key: "k-close" })
    const again = await sdk.close({ thread: "dur-local", idempotency_key: "k-close" })
    expect(s.closed).toHaveLength(1)
    expect(again).toEqual(first)
  })

  test("#given an interrupt of a thread on device b #when it is repeated under the same key #then b's engine is interrupted once", async () => {
    const a = account()
    const sdk = surface(a.remote).sdk()
    const first = await sdk.interrupt({ thread: "dur-on-b", idempotency_key: "k-int" })
    const again = await sdk.interrupt({ thread: "dur-on-b", idempotency_key: "k-int" })
    expect(interruptsOn(a.sent)).toBe(1)
    expect(again).toEqual(first)
  })

  test("#given a rename repeated under one key with other arguments #when it runs #then idempotency_conflict and nothing is renamed twice", async () => {
    const s = surface(account().remote)
    const sdk = s.sdk()
    await sdk.rename({ thread: "dur-local", name: "first", idempotency_key: "k-ren" })
    const conflicting = await sdk.rename({ thread: "dur-local", name: "second", idempotency_key: "k-ren" })
    expect(conflicting).toMatchObject({ kind: "error", error: { code: "idempotency_conflict" } })
    expect(s.setSessionName.mock.calls.map(([, name]) => name)).toEqual(["first"])
  })

  test("#given the store committed the admission and lost its reply #when the caller repeats the close under its key #then it closes once", async () => {
    const s = surface(account().remote, { loseAdmissionReply: 1 })
    const sdk = s.sdk()
    const lost = await sdk.close({ thread: "dur-local", idempotency_key: "k-lost" })
    expect(lost).toMatchObject({ kind: "error", error: { code: "internal_error" } })
    const retried = await sdk.close({ thread: "dur-local", idempotency_key: "k-lost" })
    expect(retried).toMatchObject({ kind: "ok", closed: true })
    expect(s.closed).toHaveLength(1)
  })

  test("#given no key #when the same close runs twice #then each call is its own operation", async () => {
    const s = surface(account().remote)
    const sdk = s.sdk()
    await sdk.close({ thread: "dur-local" })
    await sdk.close({ thread: "dur-local" })
    expect(s.closed).toHaveLength(2)
  })
})
