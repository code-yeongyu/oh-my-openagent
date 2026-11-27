import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const sdkModule = process.env.OMO_GATEWAY_TEST_SDK_MODULE ?? "packages/omo-senpi/plugin/runtime/thread-sdk/sdk.js"
const { createThreadSdk } = await import(pathToFileURL(resolve(sdkModule)).href)
const agentDir = mkdtempSync(join(tmpdir(), "store-extension-sdk-"))
const options = {
  agentDir,
  cwd: agentDir,
  uid: 12345,
  user: "fixture",
  env: {},
  engineStatusAll: async () => undefined,
}
const sdk = createThreadSdk(options)
const moduleUrl = new URL("./store-extension.mjs", import.meta.url).href
const dbPath = join(agentDir, "gateway", "gateway.sqlite")
try {
  const sessions = join(agentDir, "sessions", "--fixture--")
  mkdirSync(sessions, { recursive: true })
  writeFileSync(
    join(sessions, "2026-10-01T00-00-00-000Z_target.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "target", cwd: agentDir, timestamp: "2026-10-01T00:00:00.000Z" })}\n`,
  )
  for (const name of ["alpha", "omo_gateway"]) {
    const columns =
      name === "omo_gateway" ? "id TEXT PRIMARY KEY, value TEXT UNIQUE" : "id INTEGER PRIMARY KEY, value TEXT"
    assert.deepEqual(
      await sdk.registerStoreExtension({ name, moduleUrl, migrations: [[`CREATE TABLE ${name}_items (${columns})`]] }),
      { kind: "ok", value: { version: 1 } },
    )
  }
  assert.deepEqual(
    await sdk.extensionCall("omo_gateway", "put", { name: "omo_gateway", id: "one", value: "compiled SDK" }),
    { kind: "ok", value: { value: "compiled SDK" } },
  )
  assert.equal(
    (
      await sdk.extensionCall("omo_gateway", "sql", {
        sql: "INSERT INTO MAIN.OMO_GATEWAY_ITEMS VALUES ('two', 'what?')",
      })
    ).kind,
    "ok",
  )
  assert.equal(
    (await sdk.registerStoreExtension({ name: "omo_gateway", moduleUrl, migrations: [] })).code,
    "gateway_schema_too_new",
  )
  assert.equal((await sdk.extensionCall("omo_gateway", "put", { bad: () => undefined })).code, "invalid_arguments")
  assert.equal(
    (await sdk.registerStoreExtension({ name: "gateway", moduleUrl, migrations: [] })).code,
    "extension_schema_violation",
  )
  assert.equal(
    (await sdk.extensionCall("omo_gateway", "sql", { sql: "DELETE FROM gateway_meta" })).code,
    "extension_schema_violation",
  )
  const db = new Database(dbPath, { readonly: true })
  try {
    assert.deepEqual(db.query("SELECT COUNT(*) AS n FROM deliveries").get(), { n: 0 })
    assert.deepEqual(db.query("SELECT owner FROM extension_objects WHERE name = 'omo_gateway_items'").get(), {
      owner: "omo_gateway",
    })
    assert.deepEqual(
      db.query("SELECT owner FROM extension_objects WHERE name LIKE 'sqlite_autoindex_omo_gateway_items_%'").all(),
      [{ owner: "omo_gateway" }, { owner: "omo_gateway" }],
    )
  } finally {
    db.close()
  }
  assert.deepEqual(await sdk.extensionCall("omo_gateway", "rows", { name: "omo_gateway" }), {
    kind: "ok",
    value: [
      { id: "one", value: "compiled SDK" },
      { id: "two", value: "what?" },
    ],
  })
  await sdk.dispose()
  const newerDb = new Database(dbPath)
  try {
    newerDb.exec("PRAGMA user_version = 6")
  } finally {
    newerDb.close()
  }
  const olderSdk = createThreadSdk(options)
  try {
    assert.equal(
      (await olderSdk.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })).code,
      "gateway_schema_too_new",
    )
  } finally {
    await olderSdk.dispose()
  }
  console.log(
    "PASS SDK: automatic indexes, quoted parameters, case folding, ownership, clone/core recovery, shared target validation, joined rollback, postcommit markers, newer-schema refusal",
  )
} finally {
  await sdk.dispose()
  rmSync(agentDir, { recursive: true, force: true })
  assert.equal(existsSync(agentDir), false)
  console.log("CLEANUP SDK: worker disposed; directory REMOVED")
}
