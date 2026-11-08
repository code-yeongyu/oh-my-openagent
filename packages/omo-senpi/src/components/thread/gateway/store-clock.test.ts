import { afterEach, describe, expect, test } from "bun:test"

import type { GatewayEndpointPort } from "./adapter"
import { createInboxDrain } from "./drain"
import { createGatewayEngine, resolveFromEntries } from "./engine"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// Years before any wall clock this suite runs under, so a component that stamps or expires rows
// with Date.now instead of the store's clock is always more than the 24 h queued lifetime off.
const STORE_EPOCH = Date.UTC(2020, 0, 1, 0, 0, 0)

const UNREACHABLE: GatewayEndpointPort = {
  wake: async () => {
    throw new Error("unreachable")
  },
}

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe("the store's clock is the one clock", () => {
  test("#given a store whose clock is years behind the wall clock #when a drain built with only that store drains a fresh delivery #then it admits the row instead of expiring it by the wall clock", async () => {
    const h = (harness = createGatewayHarness({ startAt: STORE_EPOCH }))
    h.session("A")
    const b = h.session("B", { online: false })
    const sent = await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "fresh by the store's clock" })
    if (sent.kind !== "ok") throw new Error(JSON.stringify(sent))
    const runtime = new FakeSessionRuntime(b.runtime.sessionPath, "B", h.agentDir, { reopen: true })
    const drain = createInboxDrain({ store: h.store(), runtime, durableId: "B", sessionPath: () => runtime.sessionPath })

    const result = await drain.drain({ reason: "start" })

    expect(result.admitted).toEqual([{ delivery_id: sent.delivery_id, kind: "started" }])
    drain.stop()
  })

  test("#given a store whose clock is years behind the wall clock #when an engine built with only that store delivers #then the row is stamped and expires by the store's clock", async () => {
    const h = (harness = createGatewayHarness({ startAt: STORE_EPOCH }))
    h.session("A")
    h.session("B", { online: false })
    const store = h.store()
    const engine = createGatewayEngine({ store, endpoints: UNREACHABLE, resolve: resolveFromEntries(h.entries, () => h.agentDir) })

    const sent = await engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "stamped by the store's clock" })

    if (sent.kind !== "ok") throw new Error(JSON.stringify(sent))
    const row = (await store.deliveryView(sent.delivery_id))?.row
    expect({ created_at: row?.created_at, expires_after_ms: (row?.expires_at ?? 0) - STORE_EPOCH }).toEqual({ created_at: STORE_EPOCH, expires_after_ms: 24 * 60 * 60 * 1000 })
  })
})
