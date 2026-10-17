import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

test("#given populated v5 storage #when the historical v4 worker reads and writes #then version extension data and existing actors survive", async () => {
  const h = (harness = createGatewayHarness())
  h.phantom("target")
  const current = h.store()
  const descriptor = { name: "alpha", moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)", "INSERT INTO alpha_items VALUES (7, 'preserved')"]] }
  expect((await current.registerStoreExtension(descriptor)).kind).toBe("ok")
  const bound = await current.bind({ now: h.clock.now, receipt: null, binding: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat", root_message_id: null, progress_message_id: null, session_durable_id: "target", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["report"], policy_id: "default", ttl_seconds: null } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const sender = (userId: string) => ({
    kind: "external" as const, binding_id: bound.binding.binding_id, binding_revision: 1,
    origin: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat", message_id: userId, author: { platform_user_id: "p1", display: "Fixture", user_id: userId } },
  })
  expect((await h.engineFor(current).deliver({ sender: sender("current-actor"), target: "target", text: "before" })).kind).toBe("ok")
  await current.dispose()

  const old = h.store({ workerModuleUrl: new URL("./testing/v4/gateway-store-worker.mjs", import.meta.url) })
  const before = await old.list()
  expect(before.map((row) => row.body)).toEqual(["before"])
  expect(before[0]).not.toHaveProperty("actor_user_id")
  expect((await h.engineFor(old).deliver({ sender: sender("old-actor"), target: "target", text: "from v4" })).kind).toBe("ok")
  await old.dispose()

  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length })
    expect(db.query("SELECT body, actor_user_id FROM deliveries ORDER BY seq").all()).toEqual([
      { body: "before", actor_user_id: "current-actor" }, { body: "from v4", actor_user_id: null },
    ])
    expect(db.query("SELECT name, version FROM extension_schema").all()).toEqual([{ name: "alpha", version: 1 }])
    expect(db.query("SELECT owner FROM extension_objects WHERE name='alpha_items'").get()).toEqual({ owner: "alpha" })
  } finally { db.close() }
  const reopened = h.store()
  expect(await reopened.registerStoreExtension(descriptor)).toEqual({ kind: "ok", value: { version: 1 } })
  expect(await reopened.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [{ id: 7, value: "preserved" }] })
})
