import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
import { createGatewayStore, type GatewayStore } from "./store"

const stores: GatewayStore[] = []
const roots: string[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Two processes' stores over one agent dir: a different instance id is what a restarted or other runtime looks like. */
function twoInstances(now: () => number = Date.now): { readonly a: GatewayStore; readonly b: GatewayStore } {
  const agentDir = mkdtempSync(join(tmpdir(), "omo-gateway-tool-receipts-"))
  roots.push(agentDir)
  const a = createGatewayStore({ agentDir, instanceId: "instance-a", now })
  const b = createGatewayStore({ agentDir, instanceId: "instance-b", now })
  stores.push(a, b)
  return { a, b }
}

const scope = (key: string) => ({ principal: "session:caller-1", operation: "thread_send", idempotency_key: key })

describe("tool receipts in the gateway store (replay, conflict, in_progress, uncertain)", () => {
  test("#given a call this instance began #when the same key arrives again #then it is in_progress, different arguments are conflict, and a completed receipt replays its result to any instance", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    expect(await a.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    expect(await a.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-1" })).toEqual({ kind: "in_progress" })
    expect(await a.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-2" })).toEqual({ kind: "conflict" })
    expect(await a.toolReceiptSettle({ ...scope("k-1"), now, result: { thread_id: "t-1", seq: 1 } })).toBe(true)
    expect(await b.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-1" })).toEqual({
      kind: "replay",
      result: { thread_id: "t-1", seq: 1 },
    })
    expect(await b.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-2" })).toEqual({ kind: "conflict" })
  })

  test("#given a call another instance began and never settled #when this instance retries the key #then it is uncertain with a note, stays uncertain, and the original owner can no longer settle it", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    expect(await a.toolReceiptBegin({ ...scope("k-2"), now, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    const first = await b.toolReceiptBegin({ ...scope("k-2"), now, args_hash: "h-1" })
    expect(first.kind).toBe("uncertain")
    expect(first.kind === "uncertain" ? first.error_note : null).toContain("ended before recording its outcome")
    expect(await b.toolReceiptBegin({ ...scope("k-2"), now, args_hash: "h-1" })).toEqual(first)
    expect(await a.toolReceiptSettle({ ...scope("k-2"), now, result: { late: true } })).toBe(false)
    expect(await a.toolReceiptBegin({ ...scope("k-2"), now, args_hash: "h-1" })).toEqual(first)
  })

  test("#given a side effect that threw #when the key is retried by the same or another instance #then it is uncertain carrying the thrown error, never accepted again", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    expect(await a.toolReceiptBegin({ ...scope("k-3"), now, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    expect(await a.toolReceiptSettle({ ...scope("k-3"), now, error_note: "transport exploded mid-delivery" })).toBe(
      true,
    )
    const expected = { kind: "uncertain" as const, error_note: "transport exploded mid-delivery" }
    expect(await a.toolReceiptBegin({ ...scope("k-3"), now, args_hash: "h-1" })).toEqual(expected)
    expect(await b.toolReceiptBegin({ ...scope("k-3"), now, args_hash: "h-1" })).toEqual(expected)
  })

  test("#given a call that wrote nothing #when its owner releases the receipt #then the key is accepted as a new call, while another instance's receipt and a settled one are never dropped", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    expect(await a.toolReceiptBegin({ ...scope("k-5"), now, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    expect(await b.toolReceiptRelease(scope("k-5"))).toBe(false)
    expect(await a.toolReceiptRelease(scope("k-5"))).toBe(true)
    expect(await b.toolReceiptBegin({ ...scope("k-5"), now, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    expect(await b.toolReceiptSettle({ ...scope("k-5"), now, result: { ok: true } })).toBe(true)
    expect(await b.toolReceiptRelease(scope("k-5"))).toBe(false)
    expect(await a.toolReceiptBegin({ ...scope("k-5"), now, args_hash: "h-1" })).toEqual({
      kind: "replay",
      result: { ok: true },
    })
  })

  // #14623 review H1: an uncertain receipt a caller may recover (thread_create) is reserved for ONE retry at a time,
  // keeps its first cause through every failed or crashed retry, and records the retry's answer when it succeeds.
  test("#given an uncertain receipt #when a recovering retry begins #then it is reserved for that retry and an overlapping retry is in_progress", async () => {
    const { a } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-1"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-1"), now, error_note: "first cause" })
    expect(await a.toolReceiptBegin({ ...scope("r-1"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "retry",
      error_note: "first cause",
    })
    expect(await a.toolReceiptBegin({ ...scope("r-1"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "in_progress",
      recovery: { error_note: "first cause" },
    })
  })

  // #14623 review round 2 H1: the owner's own in_progress says which reservation it found, so a caller whose admission
  // reply was lost can resume a recovery as a recovery (first cause kept) and a fresh call as a fresh one.
  test("#given a fresh reservation and a recovery reservation #when their owner begins each key again #then only the recovery's in_progress carries its first cause", async () => {
    const { a } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-7f"), now, args_hash: "h", retry_uncertain: true })
    expect(await a.toolReceiptBegin({ ...scope("r-7f"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "in_progress",
    })
    await a.toolReceiptBegin({ ...scope("r-7r"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-7r"), now, error_note: "first cause" })
    await a.toolReceiptBegin({ ...scope("r-7r"), now, args_hash: "h", retry_uncertain: true })
    expect(await a.toolReceiptBegin({ ...scope("r-7r"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "in_progress",
      recovery: { error_note: "first cause" },
    })
  })

  test("#given a reserved retry that succeeds #when it settles #then the receipt completes and every later call replays it", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-2"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-2"), now, error_note: "first cause" })
    await a.toolReceiptBegin({ ...scope("r-2"), now, args_hash: "h", retry_uncertain: true })
    expect(await a.toolReceiptSettle({ ...scope("r-2"), now, result: { thread: "t" } })).toBe(true)
    expect(await b.toolReceiptBegin({ ...scope("r-2"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "replay",
      result: { thread: "t" },
    })
  })

  test("#given a reserved retry that fails #when it settles with its own note #then the receipt is uncertain under the first cause and may be retried again", async () => {
    const { a } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-3"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-3"), now, error_note: "first cause" })
    await a.toolReceiptBegin({ ...scope("r-3"), now, args_hash: "h", retry_uncertain: true })
    expect(await a.toolReceiptSettle({ ...scope("r-3"), now, error_note: "second cause" })).toBe(true)
    expect(await a.toolReceiptBegin({ ...scope("r-3"), now, args_hash: "h" })).toEqual({
      kind: "uncertain",
      error_note: "first cause",
    })
    expect(await a.toolReceiptBegin({ ...scope("r-3"), now, args_hash: "h", retry_uncertain: true })).toEqual({
      kind: "retry",
      error_note: "first cause",
    })
  })

  test("#given a reserved retry whose process ended #when another instance begins the key #then the receipt is uncertain under the first cause, not the crash note", async () => {
    const { a, b } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-4"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-4"), now, error_note: "first cause" })
    await a.toolReceiptBegin({ ...scope("r-4"), now, args_hash: "h", retry_uncertain: true })
    expect(await b.toolReceiptBegin({ ...scope("r-4"), now, args_hash: "h" })).toEqual({
      kind: "uncertain",
      error_note: "first cause",
    })
  })

  test("#given an uncertain receipt #when a caller that may not recover begins it #then it is answered uncertain and nothing is reserved", async () => {
    const { a } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-5"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-5"), now, error_note: "first cause" })
    const uncertain = { kind: "uncertain" as const, error_note: "first cause" }
    expect(await a.toolReceiptBegin({ ...scope("r-5"), now, args_hash: "h" })).toEqual(uncertain)
    expect(await a.toolReceiptBegin({ ...scope("r-5"), now, args_hash: "h" })).toEqual(uncertain)
  })

  test("#given a reserved retry #when its owner releases the key #then the release is refused and the first cause stays", async () => {
    const { a } = twoInstances()
    const now = Date.now()
    await a.toolReceiptBegin({ ...scope("r-6"), now, args_hash: "h" })
    await a.toolReceiptSettle({ ...scope("r-6"), now, error_note: "first cause" })
    await a.toolReceiptBegin({ ...scope("r-6"), now, args_hash: "h", retry_uncertain: true })
    expect(await a.toolReceiptRelease(scope("r-6"))).toBe(false)
    await a.toolReceiptSettle({ ...scope("r-6"), now, error_note: "later" })
    expect(await a.toolReceiptBegin({ ...scope("r-6"), now, args_hash: "h" })).toEqual({
      kind: "uncertain",
      error_note: "first cause",
    })
  })

  test("#given receipts are kept thirty days #when a completed receipt is older than that #then the key is accepted as a new call", async () => {
    let clock = Date.now()
    const { a } = twoInstances(() => clock)
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    await a.toolReceiptSettle({ ...scope("k-4"), now: clock, result: { ok: true } })
    clock += GATEWAY_RECEIPT_RETENTION_MS - 1
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({
      kind: "replay",
      result: { ok: true },
    })
    clock += 2
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({ kind: "accepted" })
  })
})
