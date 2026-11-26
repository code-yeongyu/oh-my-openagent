import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// #14623 review M1: a delivery receipt written before the binding removal hashed `binding: null` into every ordinary
// send's arguments. A retry of that unchanged send after the upgrade must replay the original delivery, never answer
// idempotency_conflict.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

/** The receipt hash the store wrote before the binding removal (binding null, no author for these senders). */
const preUpgradeHash = (fields: Record<string, unknown>): string =>
  createHash("sha256").update(JSON.stringify(fields)).digest("hex")

test.each([
  ["an ordinary send", undefined],
  ["a send with a collapse key", "alert"],
] as const)(
  "#given %s receipted before the upgrade #when it is retried unchanged #then it replays the original delivery",
  async (_label, collapseKey) => {
    const h = (harness = createGatewayHarness())
    h.session("lead", { drainRegistered: false })
    const sender = h.session("notifier")
    const request = {
      sender: { kind: "session" as const, durable_id: sender.id },
      target: "lead",
      text: "hello",
      mode: "follow_up" as const,
      idempotency_key: "pre-upgrade",
      ...(collapseKey === undefined ? {} : { collapse_key: collapseKey }),
    }
    const first = await sender.engine.deliver(request)
    expect(first.kind).toBe("ok")
    const legacy = preUpgradeHash({
      target: "lead",
      text: "hello",
      mode: "follow_up",
      expected_turn_id: null,
      binding: null,
      ...(collapseKey === undefined ? {} : { collapse_key: collapseKey }),
    })
    const db = new Database(gatewayDatabasePath(h.agentDir))
    try {
      db.run("UPDATE receipts SET args_hash = ? WHERE idempotency_key = ?", [legacy, "pre-upgrade"])
    } finally {
      db.close()
    }

    const retry = await sender.engine.deliver(request)

    expect(retry).toMatchObject({
      kind: "ok",
      deduplicated: true,
      delivery_id: first.kind === "ok" ? first.delivery_id : "",
    })
  },
)
