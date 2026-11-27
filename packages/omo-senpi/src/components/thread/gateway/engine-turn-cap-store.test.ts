import { afterEach, expect, test } from "bun:test"

import { settleGracefulClose } from "./graceful-close-returns"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRequest } from "./types"

// omo#14941: an admitted `held` row keeps its engine-turn cap in the `reason` column, which this binary and older ones
// read only on a refused row (the refusal code a sender is answered). Storage contract: the cap is read back only on the
// held row, and a refuse or a requeue after it leaves `reason` the refusal code or empty, never the cap.

const CAP = { reason: "cap-per-minute", count: 20 }

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function intake(h: GatewayHarness, deliveryId: string): IntakeRequest {
  return {
    now: h.clock.now,
    attested_device: "dev-b",
    record: {
      sessionId: "t-capped",
      deliveryId,
      text: deliveryId,
      displayText: deliveryId,
      sender: { kind: "agent", session_id: "sender-s" },
      deliverAs: "followUp",
      chainCount: 1,
    },
    provenance: { workspace: "remote", project: "remote" },
    target_session_kind: "interactive",
  }
}

test("#given rows admitted held behind the cap and under a hold #when one is refused after it and one requeued #then reason is the refusal code or empty and the cap reads only on the held row", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const self = await store.identity()
  const bodies = ["d-refused", "d-requeued", "d-capped", "d-hold"]
  for (const body of bodies) await store.intake(intake(h, body))
  const rows = Object.fromEntries((await store.list({ target_durable_id: "t-capped" })).map((row) => [row.body, row]))
  const id = (body: string) => rows[body]?.delivery_id ?? ""
  for (const body of bodies) {
    await store.claim({ now: h.clock.now, delivery_id: id(body), self, lane: "follow_up" })
    await store.recordOutcome({
      now: h.clock.now,
      delivery_id: id(body),
      self,
      outcome: {
        kind: "admitted",
        admission_kind: "held",
        turn_epoch: 4,
        ...(body === "d-hold" ? {} : { engine_turn_cap: CAP }),
      },
    })
  }

  // The close refuses every row still queued, so the requeue comes after it.
  await settleGracefulClose(store, "t-capped", [rows["d-refused"]?.ledger_id ?? id("d-refused")])
  await store.recordOutcome({ now: h.clock.now, delivery_id: id("d-requeued"), self, outcome: { kind: "requeue" } })

  const view = Object.fromEntries(
    (await store.list({ target_durable_id: "t-capped" })).map((row) => [
      row.body,
      { state: row.state, reason: row.reason, cap: row.engine_turn_cap ?? null },
    ]),
  )
  expect(view).toEqual({
    "d-refused": { state: "refused", reason: "target_closed", cap: null },
    "d-requeued": { state: "queued", reason: null, cap: null },
    "d-capped": { state: "admitted", reason: expect.any(String), cap: CAP },
    "d-hold": { state: "admitted", reason: null, cap: null },
  })
})
