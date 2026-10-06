import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"

import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

test("#given v4 rows #when opening the store #then v5 preserves data and adds nullable actor identity", async () => {
  const h = (harness = createGatewayHarness())
  mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true })
  const old = new Database(gatewayDatabasePath(h.agentDir))
  for (const step of GATEWAY_MIGRATIONS.slice(0, 4)) for (const statement of step) old.exec(statement)
  old.exec(`PRAGMA user_version = 4;
    INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at)
    VALUES ('old', 'target', 1, 'cli:1', '{}', 'keep me', 7, 'auto', 'queued', 'root-old', 1, 1, 1, 9999999999999);
    INSERT INTO session_meta (durable_id, next_seq, applied_seq) VALUES ('target', 2, 0)`)
  old.close()
  await h.store().identity()
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT user_version AS v FROM pragma_user_version()").get()).toEqual({ v: GATEWAY_MIGRATIONS.length })
    expect(db.query("SELECT body, seq, actor_user_id FROM deliveries WHERE delivery_id = 'old'").get()).toEqual({ body: "keep me", seq: 1, actor_user_id: null })
    expect(db.query("SELECT next_seq FROM session_meta WHERE durable_id = 'target'").get()).toEqual({ next_seq: 2 })
    expect(db.query("SELECT * FROM extension_schema").all()).toEqual([])
  } finally { db.close() }
})

test("#given external and unauthored sends #when enqueued #then actor_user_id comes only from author.user_id", async () => {
  const h = (harness = createGatewayHarness())
  h.phantom("target")
  const store = h.store()
  const engine = h.engineFor(store)
  const binding = await store.bind({ now: h.clock.now, receipt: null, binding: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat", root_message_id: null, progress_message_id: null, session_durable_id: "target", direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["report"], policy_id: "default", ttl_seconds: null } })
  if (binding.kind !== "ok") throw new Error(JSON.stringify(binding))
  for (const userId of ["actor-1", undefined]) {
    const sent = await engine.deliver({ sender: { kind: "external", binding_id: binding.binding.binding_id, binding_revision: 1, origin: { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat", message_id: userId ?? "no-author", ...(userId === undefined ? {} : { author: { platform_user_id: "platform-1", display: "Alice", user_id: userId } }) } }, target: "target", text: "hello" })
    expect(sent.kind).toBe("ok")
  }
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT actor_user_id FROM deliveries ORDER BY seq").all()).toEqual([{ actor_user_id: "actor-1" }, { actor_user_id: null }])
  } finally { db.close() }
})
