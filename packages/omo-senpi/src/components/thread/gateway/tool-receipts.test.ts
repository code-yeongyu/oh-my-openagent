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
    expect(await b.toolReceiptBegin({ ...scope("k-1"), now, args_hash: "h-1" })).toEqual({ kind: "replay", result: { thread_id: "t-1", seq: 1 } })
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
    expect(await a.toolReceiptSettle({ ...scope("k-3"), now, error_note: "transport exploded mid-delivery" })).toBe(true)
    const expected = { kind: "uncertain" as const, error_note: "transport exploded mid-delivery" }
    expect(await a.toolReceiptBegin({ ...scope("k-3"), now, args_hash: "h-1" })).toEqual(expected)
    expect(await b.toolReceiptBegin({ ...scope("k-3"), now, args_hash: "h-1" })).toEqual(expected)
  })

  test("#given receipts are kept thirty days #when a completed receipt is older than that #then the key is accepted as a new call", async () => {
    let clock = Date.now()
    const { a } = twoInstances(() => clock)
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({ kind: "accepted" })
    await a.toolReceiptSettle({ ...scope("k-4"), now: clock, result: { ok: true } })
    clock += GATEWAY_RECEIPT_RETENTION_MS - 1
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({ kind: "replay", result: { ok: true } })
    clock += 2
    expect(await a.toolReceiptBegin({ ...scope("k-4"), now: clock, args_hash: "h-1" })).toEqual({ kind: "accepted" })
  })
})
