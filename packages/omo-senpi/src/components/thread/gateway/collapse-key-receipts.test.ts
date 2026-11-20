import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { gatewayInboxDirectory } from "./paths"
import { createGatewayHarness, type GatewayHarness, type HarnessSession } from "./testing/harness"
import type { GatewayDeliveryResult } from "./types"

// omo#14431 review: a collapse key must keep the store's invariants - a queued row always has its inbox marker, and
// an idempotency key always replays what that send was answered (or became).

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

async function send(
  sender: HarnessSession,
  text: string,
  options: { readonly collapse_key: string; readonly idempotency_key?: string },
): Promise<GatewayDeliveryResult> {
  return await sender.engine.deliver({
    sender: { kind: "session", durable_id: sender.id },
    target: "lead",
    text,
    mode: "follow_up",
    collapse_key: options.collapse_key,
    ...(options.idempotency_key === undefined ? {} : { idempotency_key: options.idempotency_key }),
  })
}

describe("collapse key and the store's invariants", () => {
  test("#given a repeat that supersedes the queued row and is then refused by the pair budget #when it rolls back #then the queued row still has its inbox marker", async () => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")

    let refused: GatewayDeliveryResult | undefined
    for (let index = 0; index < 20 && refused === undefined; index++) {
      const result = await send(sender, `alert ${index}`, { collapse_key: "alert" })
      if (result.kind === "error") refused = result
    }

    expect(refused).toMatchObject({ kind: "error", error: { code: "pair_loop_guard" } })
    const queued = (await sender.store.list({ target_durable_id: "lead" })).filter((row) => row.state === "queued")
    expect(queued).toHaveLength(1)
    const marker = join(gatewayInboxDirectory(h.agentDir, "lead"), queued[0]?.delivery_id ?? "")
    expect(existsSync(marker)).toBe(true)
  })

  test("#given a repeat absorbed into a row the session already took #when that send is retried after the row was written #then the retry replays the absorbed answer instead of sending again", async () => {
    const h = (harness = createGatewayHarness())
    const lead = h.session("lead")
    const sender = h.session("notifier")
    lead.runtime.beginUserTurn()

    const first = await send(sender, "for 3 min", { collapse_key: "alert", idempotency_key: "k-1" })
    await h.quiesce()
    const absorbed = await send(sender, "for 6 min", { collapse_key: "alert", idempotency_key: "k-2" })
    lead.runtime.endTurn()
    await h.quiesce()

    const retried = await send(sender, "for 6 min", { collapse_key: "alert", idempotency_key: "k-2" })

    if (first.kind !== "ok" || absorbed.kind !== "ok") throw new Error("send refused")
    expect(absorbed.delivery_id).toBe(first.delivery_id)
    expect(retried).toMatchObject({ kind: "ok", delivery_id: first.delivery_id, deduplicated: true })
    expect(await sender.store.list({ target_durable_id: "lead" })).toHaveLength(1)
  })

  test("#given a send superseded by a newer one under its collapse key #when the superseded send is retried #then it replays the refusal, not its old queued answer", async () => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")

    await send(sender, "for 3 min", { collapse_key: "alert", idempotency_key: "k-1" })
    await send(sender, "for 6 min", { collapse_key: "alert", idempotency_key: "k-2" })

    expect(await send(sender, "for 3 min", { collapse_key: "alert", idempotency_key: "k-1" })).toMatchObject({
      kind: "error",
      error: { code: "not_resumable" },
    })
  })
})
