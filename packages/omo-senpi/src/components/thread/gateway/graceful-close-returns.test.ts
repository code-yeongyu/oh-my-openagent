import { afterEach, describe, expect, test } from "bun:test"

import { returnedAtClose, settleGracefulClose } from "./graceful-close-returns"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import type { IntakeRequest } from "./types"

// omo#14313: a graceful close answers every message the closed session did not read once, on the holder's store: a row
// the engine took in and handed back, and a row still queued, are refused target_closed; a row the session read is not
// touched.

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
      sessionId: "t-closing",
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

describe("settleGracefulClose", () => {
  test("#given rows the closed session handed back, read and never took #when the close settles them #then only the unread ones are refused target_closed", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    const self = await store.identity()
    for (const text of ["d-handed-back", "d-read", "d-queued"]) await store.intake(intake(h, text))
    const rowOf = async (text: string) => {
      const row = (await store.list({ target_durable_id: "t-closing" })).find((candidate) => candidate.body === text)
      if (row === undefined) throw new Error(`no row for ${text}`)
      return row
    }
    const handedBack = await rowOf("d-handed-back")
    const read = await rowOf("d-read")
    for (const row of [handedBack, read])
      expect(
        await store.claim({ now: h.clock.now, delivery_id: row.delivery_id, self, lane: "follow_up" }),
      ).toMatchObject({
        kind: "claimed",
      })
    await store.recordOutcome({
      now: h.clock.now,
      delivery_id: handedBack.delivery_id,
      self,
      outcome: { kind: "admitted", admission_kind: "queued", turn_epoch: 1 },
    })
    await store.recordOutcome({
      now: h.clock.now,
      delivery_id: read.delivery_id,
      self,
      outcome: { kind: "applied", admission_kind: "started", turn_epoch: 1 },
    })
    h.clock.now += 1000

    // The engine hands a delivery back under the id it admitted it by: the row's ledger key when it has one.
    await settleGracefulClose(store, "t-closing", [handedBack.ledger_id ?? handedBack.delivery_id])

    const states = Object.fromEntries(
      (await store.list({ target_durable_id: "t-closing" })).map((row) => [row.body, [row.state, row.reason]]),
    )
    expect(states).toEqual({
      "d-handed-back": ["refused", "target_closed"],
      "d-read": ["applied", null],
      "d-queued": ["refused", "target_closed"],
    })
  })
})

describe("returnedAtClose", () => {
  test("#given a session whose newest clean-stop record names returned deliveries #when its shutdown reads it #then those ids are answered", () => {
    const entries = [
      { type: "custom", customType: "session-closed", data: { returned: { deliveries: ["old"] } } },
      { type: "message" },
      { type: "custom", customType: "session-closed", data: { returned: { deliveries: ["d-1", "d-2"] } } },
    ]
    expect(returnedAtClose({ sessionManager: { getEntries: () => entries } })).toEqual(["d-1", "d-2"])
    expect(returnedAtClose({ sessionManager: { getEntries: () => [] } })).toEqual([])
  })
})
