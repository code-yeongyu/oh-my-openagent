import { afterEach, describe, expect, test } from "bun:test"

import { createRemoteThreadFixture } from "./thread-remote-fixture"

// B8 (security ruling, carried by T1b #14951): an unexpected exception answers internal_error with fixed text on every
// thread surface (thread_*, the thread SDK, omo thread); its text reaches only the onUnexpected port. Each case throws a
// canary and scans the whole answer, the receipt it leaves and a retry under the same key for it.

const CANARY = "canary-b8-5e1f secret=sk-live-do-not-print"
const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function world() {
  const seen: unknown[] = []
  const s = surface(account().remote, { onUnexpected: (error: unknown) => void seen.push(error) })
  const sdk = s.sdk()
  return { s, sdk, seen }
}

const fault = async () => {
  throw new Error(CANARY)
}

describe("B8: an unexpected exception on every thread surface", () => {
  test("#given a host whose listing throws #when the tool, the SDK and omo thread list and close #then each answers internal_error with no exception text, and the exception reaches onUnexpected (omo thread: omo-native thread-unexpected.test.ts)", async () => {
    const { s, sdk, seen } = world()
    Object.assign(s.host, { listView: fault, listSessions: fault })
    const answers = [
      await s.run("thread_list", {}),
      await s.run("thread_close", { thread: "dur-local" }),
      await sdk.list({}),
      await sdk.close({ thread: "dur-local" }),
    ]
    for (const answer of answers) {
      expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error" } })
      expect(JSON.stringify(answer)).not.toContain("canary-b8")
    }
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((error) => error instanceof Error && error.message === CANARY)).toBe(true)
  })

  test("#given a store whose receipt admission throws #when a keyed close runs through the tool and the SDK #then internal_error with no exception text", async () => {
    const { s, sdk, seen } = world()
    Object.assign(s.store, { toolReceiptBegin: fault })
    const args = { thread: "dur-local", idempotency_key: "k-b8-store" }
    for (const answer of [await s.run("thread_close", args), await sdk.close(args)]) {
      expect(answer).toMatchObject({ kind: "error", error: { code: "internal_error" } })
      expect(JSON.stringify(answer)).not.toContain("canary-b8")
    }
    expect(seen.length).toBe(2)
  })

  test("#given a keyed create whose body throws #when it is retried under the same key #then neither the answer nor the replayed uncertain note carries the exception text", async () => {
    const { s, seen } = world()
    Object.assign(s.host, { openSession: fault })
    const args = { name: "b8-create", idempotency_key: "k-b8-create" }
    const first = await s.run("thread_create", args)
    const retry = await s.run("thread_create", args)
    for (const answer of [first, retry]) expect(JSON.stringify(answer)).not.toContain("canary-b8")
    expect(seen.length).toBeGreaterThan(0)
  })
})
