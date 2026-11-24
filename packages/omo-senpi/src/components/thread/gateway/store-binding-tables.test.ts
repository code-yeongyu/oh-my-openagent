import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// The binding feature is gone (#14312) but its tables stay in the schema, empty and unread: an omo still on schema 14
// that opened the store before an upgrade keeps reading them on every op (#14382). Dropping them is #14859.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

/** Schema v14: a store from before the v15 deliveries rebuild and the v16 collapse key. Pinned, not `length - 1`, because later migrations append. */
const V14 = 14

const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href

const BINDING_ERA =
  "SELECT name FROM sqlite_schema WHERE name IN ('bindings', 'outbox', 'outbox_cursors', 'completion_arms') ORDER BY name"

function v14Fixture(path: string, options: { readonly bound: boolean }): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("BEGIN")
  for (const step of GATEWAY_MIGRATIONS.slice(0, V14)) for (const statement of step) db.exec(statement)
  db.exec(`PRAGMA user_version = ${V14}`)
  db.exec("COMMIT")
  if (!options.bound) {
    db.close()
    return
  }
  db.exec(`INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id,
    session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at,
    updated_at, lease_started_at) VALUES ('bnd-1', 1, 'active', 'slack', 'acct', 'c1', 't1', 'realm', 'target', 1, 1,
    'auto', '["report"]', 'dori:v1:route-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
  db.exec(`INSERT INTO outbox (binding_id, revision, event_kind, payload, state, created_at)
    VALUES ('bnd-1', 1, 'report', '{}', 'pending', 1)`)
  db.exec("INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES ('bnd-1', 0, 1)")
  db.exec(`INSERT INTO completion_arms (session_durable_id, binding_id, revision, text, armed_at)
    VALUES ('target', 'bnd-1', 1, 'done', 1)`)
  db.exec(`INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested,
    state, root_id, hop, created_at, updated_at, expires_at, binding_id, binding_revision, actor_user_id)
    VALUES ('d-bound', 'target', 1, 'binding:bnd-1', '{"provenance":{"workspace":"w","project":"p"}}', 'from chat', 9,
    'auto', 'queued', 'root', 1, 1, 1, 9999999999999, 'bnd-1', 1, 'u1')`)
  db.close()
}

test("#given a v14 store holding a binding, its outbox, cursor, completion arm and a bound delivery #when the current store opens it #then it migrates to the current version and every binding-era table keeps its rows untouched", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path, { bound: true })
  const store = h.store()
  try {
    await store.identity()
  } finally {
    await store.dispose()
  }
  const db = new Database(path)
  const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  try {
    expect({
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      tables: db.query(BINDING_ERA).all(),
      rows: [count("bindings"), count("outbox"), count("outbox_cursors"), count("completion_arms")],
      deliveries: db.query("SELECT delivery_id, body FROM deliveries").all(),
    }).toEqual({
      version: GATEWAY_MIGRATIONS.length,
      tables: [{ name: "bindings" }, { name: "completion_arms" }, { name: "outbox" }, { name: "outbox_cursors" }],
      rows: [1, 1, 1, 1],
      deliveries: [{ delivery_id: "d-bound", body: "from chat" }],
    })
  } finally {
    db.close()
  }
})

// dori-extension imports each thread route's owner from the binding rows through tx.bindingFor on its next open.
test.each([
  ["holding the binding", true, { binding_id: "bnd-1", policy_id: "dori:v1:route-1", session_durable_id: "target" }],
  ["with no binding rows", false, null],
] as const)(
  "#given a v14 store %s #when an extension reads the thread's legacy binding after the upgrade #then it gets the owner while the row exists, else null",
  async (_label, bound, expected) => {
    const h = (harness = createGatewayHarness())
    v14Fixture(gatewayDatabasePath(h.agentDir), { bound })
    const store = h.store()
    expect(
      (
        await store.registerStoreExtension({
          name: "alpha",
          moduleUrl,
          migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
        })
      ).kind,
    ).toBe("ok")
    expect(
      await store.extensionCall("alpha", "legacyBinding", {
        where: { platform: "slack", account_id: "acct", chat_id: "c1", thread_id: "t1" },
      }),
    ).toEqual({ kind: "ok", value: expected })
  },
)

// An extension's import path must not depend on whether the binding-era tables still exist: a store a train build already
// migrated may have dropped `bindings`, every other store keeps it empty. Both answer null and the import runs the same.
test.each([
  ["kept and empty", false],
  ["absent", true],
] as const)(
  "#given a store whose bindings table is %s #when an extension registers and imports a thread's legacy binding #then it registers, gets null, and its own writes work",
  async (_label, dropped) => {
    const h = (harness = createGatewayHarness())
    const path = gatewayDatabasePath(h.agentDir)
    v14Fixture(path, { bound: false })
    const seed = h.store()
    await seed.identity()
    await seed.dispose()
    if (dropped) {
      const db = new Database(path)
      db.exec("DROP TABLE bindings")
      db.close()
    }
    const store = h.store()
    const registered = await store.registerStoreExtension({
      name: "alpha",
      moduleUrl,
      migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
    })
    expect({
      registered: registered.kind,
      binding: await store.extensionCall("alpha", "legacyBinding", {
        where: { platform: "slack", account_id: "acct", chat_id: "c1", thread_id: "t1" },
      }),
      put: await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "route" }),
    }).toEqual({
      registered: "ok",
      binding: { kind: "ok", value: null },
      put: { kind: "ok", value: { value: "route" } },
    })
  },
)
