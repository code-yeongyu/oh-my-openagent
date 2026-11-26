import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ThreadToolResult } from "../contracts"
import { createGatewayStore, type GatewayStore } from "../gateway/store"
import { createReceipts, RECEIPT_HORIZON_MS, withReceiptExpiry } from "./receipts"

// #14951 review 6064335726 (HIGH): a control call's idempotency key acts at most once WITHIN its horizon, on the one
// receipt protocol the tools and the thread SDK both run. Driven over a real gateway store on a virtual clock; the body
// counts its effects, so a second effect anywhere fails the case.

const dirs: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_800_000_000_000

function world() {
  const agentDir = mkdtempSync(join(tmpdir(), "receipts-horizon-"))
  dirs.push(agentDir)
  const clock = { now: T0 }
  const open = () => {
    const store = createGatewayStore({ agentDir, now: () => clock.now })
    stores.push(store)
    return createReceipts(store, () => clock.now)
  }
  let effects = 0
  const call = async (receipts: ReturnType<typeof createReceipts>, key: string, args: unknown = { thread: "t-1" }) => {
    const scope = { principal: "cli:501", operation: "thread_close" as const, idempotency_key: key }
    const admission = await receipts.admit(scope, args, true)
    if (admission.kind === "answer") return admission.result
    effects += 1
    const result: ThreadToolResult = {
      kind: "ok",
      thread: "t-1",
      closed: true,
      reason: "closed",
      dropped_deliveries: [],
    }
    await receipts.settle(scope, result, admission.retrying)
    return withReceiptExpiry(result, admission.expires_at)
  }
  return { clock, open, call, effects: () => effects }
}

describe("the repeat horizon of a control call's idempotency key", () => {
  test("#given a keyed call #when it is repeated one ms before the horizon #then it answers the first outcome with the same expiry and acts once", async () => {
    const w = world()
    const receipts = w.open()
    const first = await w.call(receipts, "k")
    w.clock.now = T0 + RECEIPT_HORIZON_MS - 1
    const again = await w.call(receipts, "k")
    expect(w.effects()).toBe(1)
    expect(again).toEqual(first)
    expect(first).toMatchObject({ receipt_expires_at: new Date(T0 + RECEIPT_HORIZON_MS).toISOString() })
  })

  test("#given a keyed call #when it is repeated at the horizon #then the key is a new call and acts again", async () => {
    const w = world()
    const receipts = w.open()
    await w.call(receipts, "k")
    w.clock.now = T0 + RECEIPT_HORIZON_MS
    const later = await w.call(receipts, "k")
    expect(w.effects()).toBe(2)
    expect(later).toMatchObject({ receipt_expires_at: new Date(T0 + 2 * RECEIPT_HORIZON_MS).toISOString() })
  })

  test("#given a keyed call #when the store restarts inside the horizon and the call is repeated #then the receipt answers it and nothing acts twice", async () => {
    const w = world()
    const first = await w.call(w.open(), "k")
    await stores.splice(0).pop()?.dispose()
    w.clock.now = T0 + 60_000
    const afterRestart = await w.call(w.open(), "k")
    expect(w.effects()).toBe(1)
    expect(afterRestart).toEqual(first)
  })

  test("#given a keyed call #when the key is reused with other arguments inside the horizon #then idempotency_conflict and nothing acts", async () => {
    const w = world()
    const receipts = w.open()
    await w.call(receipts, "k", { thread: "t-1" })
    const reused = await w.call(receipts, "k", { thread: "t-2" })
    expect(reused).toMatchObject({ kind: "error", error: { code: "idempotency_conflict" } })
    expect(w.effects()).toBe(1)
  })
})
