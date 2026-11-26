import { Database } from "bun:sqlite"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// The binding-era tables stay in the schema after the binding removal (#14312) so an omo still running schema 14 keeps
// working (#14382); dropping them is #14859. Until then nothing may write them: only the read-only tx.bindingFor reads
// `bindings`. Two guards: an audit of every SQL write the shipped store worker can run, and a store driven through its
// operations, an extension's attempted writes included, whose binding-era rows must come out byte-identical.

const BINDING_ERA = ["bindings", "outbox", "outbox_cursors", "completion_arms"] as const

const SHIPPED_WORKER = new URL("../../../../plugin/extensions/gateway-store-worker.mjs", import.meta.url)

/** Every SQL write statement in `text` with its target: a table name, or `${` when the target is computed. */
function sqlWrites(text: string): readonly { readonly verb: string; readonly target: string }[] {
  const writes =
    /\b(INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+("?)(\$\{|[A-Za-z_]\w*)/g
  return [...text.matchAll(writes)].map((match) => ({
    verb: (match[1] ?? "").split(/\s+/)[0] ?? "",
    target: match[3] ?? "",
  }))
}

test("#given the shipped store worker #when every SQL write it can run is listed #then none targets a binding-era table and none computes its table name", () => {
  const writes = sqlWrites(readFileSync(SHIPPED_WORKER, "utf8"))
  // The scan must see the worker's real writes, or an empty result would prove nothing.
  expect(writes.some((write) => write.verb === "INSERT" && write.target === "deliveries")).toBe(true)
  expect(writes.filter((write) => (BINDING_ERA as readonly string[]).includes(write.target))).toEqual([])
  expect(writes.filter((write) => write.target === "${")).toEqual([])
})

test("#given the schema's migrations #when their writes are listed #then none targets a binding-era table, so an upgrade never rewrites their rows", () => {
  const writes = sqlWrites(GATEWAY_MIGRATIONS.flat().join("\n"))
  expect(writes.filter((write) => (BINDING_ERA as readonly string[]).includes(write.target))).toEqual([])
})

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

/** A schema-14 store holding one row in each binding-era table, as a released omo with bindings leaves it. */
function v14StoreWithBindingRows(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec("BEGIN")
  for (const step of GATEWAY_MIGRATIONS.slice(0, 14)) for (const statement of step) db.exec(statement)
  db.exec("PRAGMA user_version = 14")
  db.exec("COMMIT")
  db.exec(`INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id,
    session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at,
    updated_at, lease_started_at) VALUES ('bnd-1', 1, 'active', 'slack', 'acct', 'c1', 't1', 'realm', 'lead', 1, 1,
    'auto', '["report"]', 'dori:v1:route-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
  db.exec(`INSERT INTO outbox (binding_id, revision, event_kind, payload, state, created_at)
    VALUES ('bnd-1', 1, 'report', '{}', 'pending', 1)`)
  db.exec("INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES ('bnd-1', 0, 1)")
  db.exec(`INSERT INTO completion_arms (session_durable_id, binding_id, revision, text, armed_at)
    VALUES ('lead', 'bnd-1', 1, 'done', 1)`)
  db.close()
}

/** Every row of every binding-era table, in a stable order: two equal snapshots mean nothing was written. */
function bindingEraRows(path: string): Readonly<Record<string, unknown[]>> {
  const db = new Database(path, { readonly: true })
  try {
    return Object.fromEntries(
      BINDING_ERA.map((table) => [table, db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    )
  } finally {
    db.close()
  }
}

test("#given a schema-14 store with binding rows #when the current store migrates it, delivers, drains, and an extension tries to write those tables #then every binding-era row is unchanged", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  v14StoreWithBindingRows(path)
  const before = bindingEraRows(path)
  expect(Object.values(before).map((rows) => rows.length)).toEqual([1, 1, 1, 1])

  const lead = h.session("lead")
  const notifier = h.session("notifier")
  for (const mode of ["auto", "follow_up"] as const) {
    const sent = await notifier.engine.deliver({
      sender: { kind: "session", durable_id: "notifier" },
      target: "lead",
      text: `while lead works (${mode})`,
      mode,
      ...(mode === "follow_up" ? { collapse_key: "alert" } : {}),
    })
    expect(sent).toMatchObject({ kind: "ok" })
  }
  lead.runtime.beginUserTurn()
  lead.runtime.endTurn()
  await h.quiesce()
  await notifier.store.list({ target_durable_id: "lead" })
  await notifier.store.backlogs(["lead"])

  const store = h.store()
  expect(
    (
      await store.registerStoreExtension({
        name: "alpha",
        moduleUrl: new URL("./testing/store-extension.mjs", import.meta.url).href,
        migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
      })
    ).kind,
  ).toBe("ok")
  for (const sql of [
    "INSERT INTO bindings (binding_id) VALUES ('bnd-2')",
    "UPDATE bindings SET status = 'closed'",
    "DELETE FROM outbox",
    "INSERT INTO outbox_cursors (binding_id, acked_cursor, updated_at) VALUES ('bnd-2', 1, 1)",
    "DELETE FROM completion_arms",
  ])
    expect(await store.extensionCall("alpha", "sql", { sql })).toMatchObject({ kind: "refused" })
  expect(
    await store.extensionCall("alpha", "legacyBinding", {
      where: { platform: "slack", account_id: "acct", chat_id: "c1", thread_id: "t1" },
    }),
  ).toMatchObject({ kind: "ok", value: { binding_id: "bnd-1" } })

  expect(bindingEraRows(path)).toEqual(before)
})
