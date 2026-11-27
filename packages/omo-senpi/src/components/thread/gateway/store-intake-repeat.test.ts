import { afterEach, describe, expect, test } from "bun:test"

import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRequest } from "./types"

// A repeat of a delivery id from the same device after its receipt expired (the base's review LOW): the row is still in
// the store, so the repeat is answered from that row as deduplicated and never reaches the insert's unique index.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const DAY_MS = 24 * 60 * 60 * 1000

function request(h: GatewayHarness): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: "dev-a",
    record: {
      sessionId: "target",
      deliveryId: "d-1",
      text: "OMO_GATEWAY v=1\nsource=peer_agent\n\nhello",
      displayText: "hello",
      sender: { kind: "agent", session_id: "sender-s" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

describe("a repeated delivery id after its receipt expired", () => {
  test("#given an open intake row whose receipt expired #when the same device repeats the delivery id #then the answer comes from that row as deduplicated and no second row is written", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const first = await store.intake(request(h))
    if (first.kind !== "queued") throw new Error(`intake refused: ${JSON.stringify(first)}`)

    h.clock.now += GATEWAY_RECEIPT_RETENTION_MS + 1
    const repeat = await store.intake(request(h))

    expect(repeat).toMatchObject({
      kind: "queued",
      delivery_id: "d-1",
      row_id: first.row_id,
      ledger_id: first.ledger_id,
      deduplicated: true,
    })
    expect(await store.list({ target_durable_id: "target" })).toHaveLength(1)
  })

  test("#given an intake row that already finished and whose receipt expired #when the same device repeats the delivery id #then the answer comes from that row as deduplicated and no second row is written", async () => {
    const h = (harness = createGatewayHarness())
    const target = h.session("target")
    const first = await target.store.intake(request(h))
    if (first.kind !== "queued") throw new Error(`intake refused: ${JSON.stringify(first)}`)
    h.clock.now += 2 * DAY_MS
    await target.drain.drain({ reason: "command" })
    await h.quiesce()
    expect(await target.store.list({ target_durable_id: "target" })).toMatchObject([
      { delivery_id: first.row_id, state: "refused", reason: "expired" },
    ])

    h.clock.now += GATEWAY_RECEIPT_RETENTION_MS
    const repeat = await target.store.intake(request(h))

    expect(repeat).toMatchObject({
      kind: "queued",
      delivery_id: "d-1",
      row_id: first.row_id,
      ledger_id: first.ledger_id,
      deduplicated: true,
    })
    expect(await target.store.list({ target_durable_id: "target" })).toHaveLength(1)
  })
})
