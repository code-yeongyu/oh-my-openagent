import { afterEach, expect, test } from "bun:test"

import { WAKE_LEASE_MS } from "./constants"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// The exits of a woken session's `opening` gate (#13037, amendment A3.1.1 and A3.1.5): a transient failure puts the row
// back to `requested` with its attempts and the time of the next one, the third deletes it, and the gate binds only
// while the row's lease is live.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

async function opening(store: GatewayStore, durableId: string): Promise<number> {
  await store.woken.request({ durable_id: durableId, session_file: `/sessions/${durableId}.jsonl` })
  const answer = await store.woken.start({ durable_id: durableId })
  if (answer.kind !== "started") throw new Error(`expected ${durableId} to start, got ${answer.kind}`)
  return answer.row.generation
}

test("#given an opening row #when a transient failure is recorded #then the row is requested again with one attempt, no lease and a next-attempt time, and a start before it answers not_yet", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const generation = await opening(store, "s1")

  const deferred = await store.woken.retryLater({ durable_id: "s1", generation })
  expect(deferred).toMatchObject({
    kind: "deferred",
    row: { state: "requested", attempts: 1, lease_owner: null, lease_expires_at: null },
  })
  if (deferred.kind !== "deferred") throw new Error("not deferred")
  const nextAttemptAt = deferred.row.next_attempt_at ?? -1
  expect(nextAttemptAt).toBeGreaterThan(h.clock.now)

  h.clock.now = nextAttemptAt - 1
  expect(await store.woken.start({ durable_id: "s1" })).toEqual({ kind: "not_yet", next_attempt_at: nextAttemptAt })
  h.clock.now = nextAttemptAt
  expect(await store.woken.start({ durable_id: "s1" })).toMatchObject({
    kind: "started",
    row: { state: "opening", attempts: 1, generation: generation + 1 },
  })
})

test("#given a row that already failed twice #when a third transient failure is recorded #then the row is deleted and the answer is failed", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  let generation = await opening(store, "s1")
  for (const expected of [1, 2]) {
    const deferred = await store.woken.retryLater({ durable_id: "s1", generation })
    if (deferred.kind !== "deferred") throw new Error(`expected deferred, got ${deferred.kind}`)
    expect(deferred.row.attempts).toBe(expected)
    h.clock.now = deferred.row.next_attempt_at ?? h.clock.now
    const again = await store.woken.start({ durable_id: "s1" })
    if (again.kind !== "started") throw new Error(`expected started, got ${again.kind}`)
    generation = again.row.generation
  }
  expect(await store.woken.retryLater({ durable_id: "s1", generation })).toEqual({ kind: "failed", attempts: 3 })
  expect(await store.woken.list()).toEqual([])
})

test("#given a stale generation #when a transient failure is recorded #then it answers lost_lease and the row is unchanged", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const generation = await opening(store, "s1")
  expect(await store.woken.retryLater({ durable_id: "s1", generation: generation - 1 })).toEqual({
    kind: "lost_lease",
  })
  expect(await store.woken.list()).toMatchObject([{ state: "opening", attempts: 0, generation }])
})

test("#given woken rows in each state #when the gate is read #then only an opening row with a live lease gates its session", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.woken.request({ durable_id: "requested", session_file: "/sessions/requested.jsonl" })
  const generation = await opening(store, "opening")

  expect(await store.woken.gated({ durable_id: "opening" })).toBe(true)
  expect(await store.woken.gated({ durable_id: "requested" })).toBe(false)
  expect(await store.woken.gated({ durable_id: "absent" })).toBe(false)

  h.clock.now += WAKE_LEASE_MS
  expect(await store.woken.gated({ durable_id: "opening" })).toBe(false)

  h.clock.now -= WAKE_LEASE_MS
  await store.woken.setState({ durable_id: "opening", generation, state: "open" })
  expect(await store.woken.gated({ durable_id: "opening" })).toBe(false)
})
