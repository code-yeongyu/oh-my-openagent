import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// Storage contract: the woken-session table arrives as its own schema step, and a store written by the build before it
// (the intake row's v12) opens on this build with every row it held.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const WOKEN_STEP = GATEWAY_MIGRATIONS.findIndex((step) =>
  step.some((statement) => statement.includes("woken_sessions")),
)

function tableColumns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name)
}

test("#given the schema #when the woken-session step is looked up #then it is a step of its own after the intake columns", () => {
  const intakeStep = GATEWAY_MIGRATIONS.findIndex((step) => step.some((statement) => statement.includes("ledger_id")))
  expect(WOKEN_STEP).toBe(intakeStep + 1)
})

test("#given a store at the previous schema holding an intake row #when this build opens it #then it reaches the current version, keeps the row, and records woken sessions", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    for (const step of GATEWAY_MIGRATIONS.slice(0, WOKEN_STEP)) for (const statement of step) db.exec(statement)
    db.exec(`PRAGMA user_version = ${WOKEN_STEP}`)
    db.query(
      `INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at, ledger_id)
       VALUES ('row-1', 'b', 1, 'device:dev-a#session:s', ?, 'before', 6, 'follow_up', 'queued', 'root-1', 1, ?, ?, ?, 'device:dev-a/d-1')`,
    ).run(
      JSON.stringify({
        provenance: { workspace: "w", project: "p", device: "dev-a" },
        origin: { session: "s" },
        actor: "s",
        via: ["s"],
        root_id: "root-1",
        hop: 1,
        delivery_id: "row-1",
      }),
      h.clock.now,
      h.clock.now,
      h.clock.now + 60_000,
    )
  } finally {
    db.close()
  }

  const store = h.store()
  expect(await store.list({ target_durable_id: "b" })).toMatchObject([
    { delivery_id: "row-1", ledger_id: "device:dev-a/d-1", state: "queued" },
  ])
  expect(await store.woken.request({ durable_id: "b", session_file: "/sessions/b.jsonl" })).toMatchObject({
    kind: "requested",
    created: true,
  })

  const check = new Database(path, { readonly: true })
  try {
    expect(check.query("PRAGMA user_version").get()).toEqual({ user_version: GATEWAY_MIGRATIONS.length })
    expect(tableColumns(check, "woken_sessions")).toEqual([
      "durable_id",
      "session_file",
      "host_instance",
      "state",
      "requested_at",
      "opened_at",
      "first_waiting_at",
      "lease_owner",
      "lease_expires_at",
      "generation",
      "attempts",
      "next_attempt_at",
    ])
    // A core object: no store extension may register a table or index under this name.
    expect(
      check.query("SELECT owner FROM extension_objects WHERE type = 'table' AND name = 'woken_sessions'").all(),
    ).toEqual([{ owner: null }])
  } finally {
    check.close()
  }
})

test("#given a current store rewound to the previous version #when it opens again #then the step re-runs without error and keeps the woken rows", async () => {
  const h = (harness = createGatewayHarness())
  const first = h.store()
  await first.woken.request({ durable_id: "s1", session_file: "/sessions/s1.jsonl" })
  await first.dispose()
  const db = new Database(gatewayDatabasePath(h.agentDir))
  try {
    db.exec(`PRAGMA user_version = ${WOKEN_STEP}`)
  } finally {
    db.close()
  }
  expect(await h.store().woken.list()).toMatchObject([{ durable_id: "s1", state: "requested" }])
})
