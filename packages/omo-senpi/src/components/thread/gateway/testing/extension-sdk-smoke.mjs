import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const sdkModule = process.env.OMO_GATEWAY_TEST_SDK_MODULE ?? "packages/omo-senpi/plugin/runtime/thread-sdk/sdk.js"
const { createThreadSdk } = await import(pathToFileURL(resolve(sdkModule)).href)
const agentDir = mkdtempSync(join(tmpdir(), "store-extension-sdk-"))
const options = { agentDir, cwd: agentDir, uid: 12345, user: "fixture", env: {}, engineStatusAll: async () => undefined }
const sdk = createThreadSdk(options)
const moduleUrl = new URL("./store-extension.mjs", import.meta.url).href
const dbPath = join(agentDir, "gateway", "gateway.sqlite")
try {
  const sessions = join(agentDir, "sessions", "--fixture--")
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, "2026-10-01T00-00-00-000Z_target.jsonl"), `${JSON.stringify({ type: "session", version: 3, id: "target", cwd: agentDir, timestamp: "2026-10-01T00:00:00.000Z" })}\n`)
  for (const name of ["alpha", "omo_gateway"]) {
    const columns = name === "omo_gateway" ? "id TEXT PRIMARY KEY, value TEXT UNIQUE" : "id INTEGER PRIMARY KEY, value TEXT"
    assert.deepEqual(await sdk.registerStoreExtension({ name, moduleUrl, migrations: [[`CREATE TABLE ${name}_items (${columns})`]] }), { kind: "ok", value: { version: 1 } })
  }
  assert.deepEqual(await sdk.extensionCall("omo_gateway", "put", { name: "omo_gateway", id: "one", value: "compiled SDK" }), { kind: "ok", value: { value: "compiled SDK" } })
  assert.equal((await sdk.extensionCall("omo_gateway", "sql", { sql: "INSERT INTO MAIN.OMO_GATEWAY_ITEMS VALUES ('two', 'what?')" })).kind, "ok")
  assert.equal((await sdk.registerStoreExtension({ name: "omo_gateway", moduleUrl, migrations: [] })).code, "gateway_schema_too_new")
  assert.equal((await sdk.extensionCall("omo_gateway", "put", { bad: () => undefined })).code, "invalid_arguments")
  assert.equal((await sdk.bindings({})).kind, "ok")
  assert.equal((await sdk.registerStoreExtension({ name: "gateway", moduleUrl, migrations: [] })).code, "extension_schema_violation")
  assert.equal((await sdk.extensionCall("omo_gateway", "sql", { sql: "DELETE FROM gateway_meta" })).code, "extension_schema_violation")
  const bound = await sdk.extensionCall("alpha", "core", { op: "bind", request: { principal: "fixture", binding: { platform: "custom", account_id: "bot", chat_id: "chat", session_durable_id: "target", ttl_seconds: null } } })
  assert.equal(bound.kind, "ok")
  assert.equal(bound.value.kind, "ok")
  const request = { binding_id: bound.value.binding.binding_id, event_id: "rolled-back", text: "hello", author: { platform_user_id: "p1", display: "Alice", user_id: "u1" } }
  const inbox = join(agentDir, "gateway", "inbox", "target")
  const failed = await sdk.extensionCall("alpha", "enqueueThenThrow", { request, inbox })
  assert.deepEqual(failed, { kind: "refused", code: "extension_operation_failed", message: "rollback requested" })
  assert.deepEqual(existsSync(inbox) ? readdirSync(inbox) : [], [])
  const db = new Database(dbPath, { readonly: true })
  try {
    assert.deepEqual(db.query("SELECT COUNT(*) AS n FROM deliveries").get(), { n: 0 })
    assert.deepEqual(db.query("SELECT owner FROM extension_objects WHERE name = 'omo_gateway_items'").get(), { owner: "omo_gateway" })
    assert.deepEqual(db.query("SELECT owner FROM extension_objects WHERE name LIKE 'sqlite_autoindex_omo_gateway_items_%'").all(), [{ owner: "omo_gateway" }, { owner: "omo_gateway" }])
  } finally { db.close() }
  const committed = await sdk.extensionCall("alpha", "core", { op: "enqueue", request: { ...request, event_id: "committed" } })
  assert.equal(committed.value.kind, "ok")
  assert.equal(readdirSync(inbox).length, 1)
  const missing = await sdk.extensionCall("alpha", "core", { op: "bind", request: { principal: "fixture", binding: { platform: "custom", account_id: "bot", chat_id: "missing", session_durable_id: "missing", ttl_seconds: null } } })
  const missingId = missing.value.binding.binding_id
  assert.equal((await sdk.send({ binding_id: missingId, text: "no target", idempotency_key: "missing" })).error.code, "not_found")
  assert.equal((await sdk.extensionCall("alpha", "core", { op: "enqueue", request: { binding_id: missingId, text: "no target", event_id: "missing" } })).value.error.code, "not_found")
  assert.deepEqual(await sdk.extensionCall("omo_gateway", "rows", { name: "omo_gateway" }), { kind: "ok", value: [{ id: "one", value: "compiled SDK" }, { id: "two", value: "what?" }] })
  await sdk.dispose()
  const newerDb = new Database(dbPath)
  try { newerDb.exec("PRAGMA user_version = 6") } finally { newerDb.close() }
  const olderSdk = createThreadSdk(options)
  try {
    assert.equal((await olderSdk.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })).code, "gateway_schema_too_new")
  } finally { await olderSdk.dispose() }
  console.log("PASS SDK: automatic indexes, quoted parameters, case folding, ownership, clone/core recovery, shared target validation, joined rollback, postcommit markers, newer-schema refusal")
} finally {
  await sdk.dispose()
  rmSync(agentDir, { recursive: true, force: true })
  assert.equal(existsSync(agentDir), false)
  console.log("CLEANUP SDK: worker disposed; directory REMOVED")
}
