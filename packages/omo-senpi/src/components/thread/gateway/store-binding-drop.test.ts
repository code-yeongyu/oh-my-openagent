import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

/** Schema v14: the last version that still had thread bindings. Pinned, not `length - 1`, because later migrations append. */
const V14 = 14

function v14Fixture(path: string, extra: readonly string[] = []): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("BEGIN")
  for (const step of GATEWAY_MIGRATIONS.slice(0, V14)) for (const statement of step) db.exec(statement)
  db.exec(`PRAGMA user_version = ${V14}`)
  db.exec("COMMIT")
  db.exec(`INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id,
    session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at,
    updated_at, lease_started_at) VALUES ('bnd-1', 1, 'active', 'slack', 'acct', 'c1', 't1', 'realm', 'target', 1, 1,
    'auto', '["report"]', 'default', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
  db.exec(`INSERT INTO outbox (binding_id, revision, event_kind, payload, state, created_at)
    VALUES ('bnd-1', 1, 'report', '{}', 'pending', 1)`)
  db.exec("INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES ('bnd-1', 0, 1)")
  db.exec(`INSERT INTO completion_arms (session_durable_id, binding_id, revision, text, armed_at)
    VALUES ('target', 'bnd-1', 1, 'done', 1)`)
  db.exec(`INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested,
    state, root_id, hop, created_at, updated_at, expires_at, binding_id, binding_revision, actor_user_id)
    VALUES ('d-bound', 'target', 1, 'binding:bnd-1', '{"provenance":{"workspace":"w","project":"p"}}', 'from chat', 9,
    'auto', 'queued', 'root', 1, 1, 1, 9999999999999, 'bnd-1', 1, 'u1')`)
  for (const statement of extra) db.exec(statement)
  db.close()
}

test("#given a v14 store holding a binding, its outbox, cursor, completion arm and a bound delivery #when the current store opens it #then the binding tables are gone, a second run of the step changes nothing, and the delivery stays", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14Fixture(path)
  const store = h.store()
  try {
    await store.identity()
  } finally {
    await store.dispose()
  }
  const rewind = new Database(path)
  rewind.exec(`PRAGMA user_version = ${GATEWAY_MIGRATIONS.length - 1}`)
  rewind.close()
  const reopened = h.store()
  try {
    await reopened.identity()
  } finally {
    await reopened.dispose()
  }
  const db = new Database(path, { readonly: true })
  try {
    expect({
      version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      tables: db
        .query(
          "SELECT name FROM sqlite_schema WHERE name IN ('bindings', 'outbox', 'outbox_cursors', 'completion_arms') ORDER BY name",
        )
        .all(),
      deliveries: db.query("SELECT delivery_id, body FROM deliveries").all(),
      staleCoreObjects: db
        .query(
          "SELECT name FROM extension_objects e WHERE owner IS NULL AND NOT EXISTS (SELECT 1 FROM sqlite_schema s WHERE s.type = e.type AND s.name = e.name COLLATE NOCASE)",
        )
        .all(),
    }).toEqual({
      version: GATEWAY_MIGRATIONS.length,
      tables: [],
      deliveries: [{ delivery_id: "d-bound", body: "from chat" }],
      staleCoreObjects: [],
    })
  } finally {
    db.close()
  }
})

// The store's connection enforces foreign keys, so without foreign_keys OFF the drop would cascade-delete these rows
// or fail the step on every open.
test.each([
  ["ON DELETE CASCADE", "REFERENCES bindings ON DELETE CASCADE"],
  ["a plain REFERENCES", "REFERENCES bindings"],
])(
  "#given an extension table referencing bindings with %s #when the store migrates to v15 #then it opens at the current version and the extension rows stay",
  async (_label, reference) => {
    const h = (harness = createGatewayHarness())
    const path = gatewayDatabasePath(h.agentDir)
    v14Fixture(path, [
      `CREATE TABLE alpha_refs (id INTEGER PRIMARY KEY, binding_seq INTEGER ${reference})`,
      "INSERT INTO alpha_refs (id, binding_seq) VALUES (1, 1), (2, 1)",
    ])
    const store = h.store()
    try {
      await store.identity()
    } finally {
      await store.dispose()
    }
    const db = new Database(path, { readonly: true })
    try {
      expect({
        version: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
        rows: db.query("SELECT id, binding_seq FROM alpha_refs ORDER BY id").all(),
      }).toEqual({
        version: GATEWAY_MIGRATIONS.length,
        rows: [
          { id: 1, binding_seq: 1 },
          { id: 2, binding_seq: 1 },
        ],
      })
    } finally {
      db.close()
    }
  },
)
