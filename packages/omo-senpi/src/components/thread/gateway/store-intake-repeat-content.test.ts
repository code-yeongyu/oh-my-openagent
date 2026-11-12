import { afterEach, expect, test } from "bun:test"

import { GATEWAY_RECEIPT_RETENTION_MS } from "./constants"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRecord, IntakeRequest } from "./types"

// The review LOWs of #13212 on a repeat answered from its ledger row: the repeat is compared with what the row holds
// (another text is a conflict, as the receipt's argument hash would answer), and it is answered before the backlog,
// placement and budget checks, so a repeat of a delivery already taken in is never refused queue_full.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function request(h: GatewayHarness, record: Partial<IntakeRecord> = {}): IntakeRequest {
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
      ...record,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

test.each([
  ["the same content", {}, "deduplicated"],
  ["another text", { text: "OMO_GATEWAY v=1\nsource=peer_agent\n\nsomething else" }, "conflict"],
  ["another display text", { displayText: "something else" }, "conflict"],
  ["another chain count", { chainCount: 2 }, "conflict"],
])(
  "#given a delivery whose receipt expired #when the same device repeats its id with %s #then the answer is %s and no second row is written",
  async (_label, change, expected) => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const first = await store.intake(request(h))
    if (first.kind !== "queued") throw new Error(`intake refused: ${JSON.stringify(first)}`)
    h.clock.now += GATEWAY_RECEIPT_RETENTION_MS + 1

    const repeat = await store.intake(request(h, change))

    if (expected === "deduplicated")
      expect(repeat).toMatchObject({ kind: "queued", row_id: first.row_id, ledger_id: first.ledger_id, deduplicated: true })
    else expect(repeat).toMatchObject({ kind: "refused", code: "idempotency_conflict" })
    expect(await store.list({ target_durable_id: "target" })).toHaveLength(1)
  },
)

test("#given a target whose backlog a taken delivery already fills past half #when that delivery is repeated after its receipt expired #then the repeat is answered deduplicated, never queue_full", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const big = `OMO_GATEWAY v=1\nsource=peer_agent\n\n${"x".repeat(600_000)}`
  const first = await store.intake(request(h, { text: big }))
  if (first.kind !== "queued") throw new Error(`intake refused: ${JSON.stringify(first)}`)
  h.clock.now += GATEWAY_RECEIPT_RETENTION_MS + 1

  const repeat = await store.intake(request(h, { text: big }))

  expect(repeat).toMatchObject({ kind: "queued", row_id: first.row_id, deduplicated: true })
})
