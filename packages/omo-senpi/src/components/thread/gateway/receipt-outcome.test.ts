import { expect, test } from "bun:test"
import { createGatewayHarness } from "./testing/harness"
import { PAIR_BUCKET_BURST, PAIR_BUCKET_REFILL_MS } from "./constants"

test.each(["expired", "not_steerable", "turn_conflict", "target_closed"] as const)(
  "a local retained receipt exposes %s without changing its original admission",
  async (reason) => {
    const h = createGatewayHarness()
    try {
      const sender = h.session("sender")
      h.phantom("target")
      const args = {
        sender: { kind: "session" as const, durable_id: "sender" },
        target: "target",
        text: "one",
        idempotency_key: "same",
      }
      const first = await sender.engine.deliver(args)
      if (first.kind !== "ok") throw new Error("missing admission")
      await sender.store.refuseQueued({ now: h.clock.now, delivery_id: first.delivery_id, reason })
      const replay = await sender.engine.deliver(args)
      expect(replay).toMatchObject({
        kind: "ok",
        delivery: first.delivery,
        delivery_id: first.delivery_id,
        deduplicated: true,
        outcome: { kind: "refused", reason },
      })
      const rows = await sender.store.list({ target_durable_id: "target" })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ state: "refused", reason, attempt: 0 })
      expect(h.wakes).toHaveLength(0)
      expect(await sender.store.refusalNotices(h.clock.now)).toHaveLength(0)
    } finally {
      await h.dispose()
    }
  },
)

test("refusal notice claims are durable, bounded and rate limited per original peer", async () => {
  const h = createGatewayHarness()
  try {
    const store = h.store()
    for (let i = 0; i <= PAIR_BUCKET_BURST; i++) {
      const outcome = await store.intake({
        now: h.clock.now,
        attested_device: "peer",
        target_session_kind: "interactive",
        provenance: { workspace: "qa", project: "qa" },
        record: {
          sessionId: `target-${i}`,
          deliveryId: `d-${i}`,
          text: "one",
          displayText: "one",
          deliverAs: "followUp",
          chainCount: 1,
          sender: { kind: "agent", session_id: "caller" },
        },
      })
      if (outcome.kind !== "queued") throw new Error(`intake: ${outcome.kind}`)
      const [row] = await store.list({ target_durable_id: `target-${i}` })
      if (row === undefined) throw new Error("missing queued row")
      await store.refuseQueued({ now: h.clock.now, delivery_id: row.delivery_id, reason: "expired" })
    }
    const candidates = await store.refusalNotices(h.clock.now)
    expect(candidates.length).toBeLessThanOrEqual(32)
    const claims = []
    for (const notice of candidates) claims.push(await store.claimRefusalNotice({ now: h.clock.now, notice }))
    expect(claims.filter(Boolean)).toHaveLength(PAIR_BUCKET_BURST)
    for (const notice of candidates) expect(await store.claimRefusalNotice({ now: h.clock.now, notice })).toBe(false)
    h.clock.now += PAIR_BUCKET_REFILL_MS
    const remaining = await store.refusalNotices(h.clock.now)
    expect(remaining).toHaveLength(1)
    const notice = remaining[0]
    if (notice === undefined) throw new Error("missing rate-limited notice")
    expect(await store.claimRefusalNotice({ now: h.clock.now, notice })).toBe(true)
    expect(await store.refusalNotices(h.clock.now)).toHaveLength(0)
  } finally {
    await h.dispose()
  }
})
