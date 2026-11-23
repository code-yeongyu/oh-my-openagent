import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

// A shipped schema-14 binary next to this one (#14382, #14622 review L2, M6), with the worker bundle omo shipped at v14
// (testing/v14/README.md). It predates the reader floor: it never reads one, and it refuses every store newer than 14.

const V14_WORKER = new URL("./testing/v14/gateway-store-worker.mjs", import.meta.url)

let harness: GatewayHarness | undefined
const stores: GatewayStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose()
  await harness?.dispose()
  harness = undefined
})

function v14(h: GatewayHarness): GatewayStore {
  const store = h.store({ workerModuleUrl: V14_WORKER })
  stores.push(store)
  return store
}

function userVersion(h: GatewayHarness): unknown {
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version
  } finally {
    db.close()
  }
}

test("#given a v14 session whose worker opened before this binary migrated the store #then it reads a start row and writes a row with no collapse key, and v16 backlog and collapse keep working", async () => {
  const h = (harness = createGatewayHarness())
  const old = v14(h)
  await old.identity()
  expect(userVersion(h)).toBe(14)

  const lead = h.session("lead")
  const notifier = h.session("notifier")
  const started = await notifier.engine.deliver({
    sender: { kind: "session", durable_id: "notifier" },
    target: "lead",
    text: "while lead is idle",
  })
  expect(started).toMatchObject({ kind: "ok", effective_mode: "start" })
  expect(userVersion(h)).toBe(GATEWAY_MIGRATIONS.length)

  const read = await settled(old.list({ target_durable_id: "lead" }))
  expect(read.error).toBeUndefined()
  expect(read.value?.map((row) => row.mode_effective)).toContain("start")

  // #14842: the start delivery stays open (taken by the lead, not yet written) until the drain its emit wakes has run in
  // the background. A baseline read before that counted it as held and then lost it once written. Wait for it, so the
  // baseline holds nothing and the count below is exactly the two rows this case holds.
  await h.quiesce()
  lead.runtime.beginUserTurn()
  const heldBefore = (await notifier.store.backlogs(["lead"]))["lead"]?.held ?? 0
  expect(heldBefore).toBe(0)
  const written = await h.engineFor(old).deliver({
    sender: { kind: "session", durable_id: "notifier" },
    target: "lead",
    text: "from the v14 binary",
    mode: "follow_up",
  })
  expect(written.kind).toBe("ok")
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT collapse_key FROM deliveries WHERE body = ?").get("from the v14 binary")).toEqual({
      collapse_key: null,
    })
  } finally {
    db.close()
  }

  const collapse = (text: string) =>
    notifier.engine.deliver({
      sender: { kind: "session", durable_id: "notifier" },
      target: "lead",
      text,
      mode: "follow_up",
      collapse_key: "alert",
    })
  const first = await collapse("alert 1")
  const second = await collapse("alert 2")
  if (first.kind !== "ok" || second.kind !== "ok") throw new Error(JSON.stringify({ first, second }))
  expect(second.collapsed).toBe(true)
  expect(second.delivery_id).toBe(first.delivery_id)
  // Held for lead: the v14 row and the one collapsed alert. Without the v14 row counted it would be heldBefore + 1.
  const backlog = (await notifier.store.backlogs(["lead"]))["lead"]
  expect(backlog?.held).toBe(heldBefore + 2)
  lead.runtime.endTurn()
  await h.quiesce()
})

test("#given a store this binary migrated #when a v14 session opens its worker afterwards #then it is refused gateway_schema_too_new: the floor helps only binaries that read it (#14622 review M6)", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().identity()
  expect(userVersion(h)).toBe(GATEWAY_MIGRATIONS.length)

  const opened = await settled(v14(h).identity())
  expect(opened.error).toMatchObject({ code: "gateway_schema_too_new" })
  expect(userVersion(h)).toBe(GATEWAY_MIGRATIONS.length)
})
