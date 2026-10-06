import { afterEach, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createThreadSdk } from "../sdk"
import { PAIR_BUCKET_BURST } from "./constants"
import { gatewayInboxDirectory, gatewayOutboxMarkerPath } from "./paths"
import type { BindingRecord } from "./bindings"
import type { GatewayStore, OutboxPage } from "./store"
import type { RelayResult } from "./relay"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const registration = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] }

async function setup() {
  const h = (harness = createGatewayHarness())
  h.phantom("target")
  const store = h.store()
  expect((await store.registerStoreExtension(registration)).kind).toBe("ok")
  return { h, store }
}

async function core<T>(store: GatewayStore, op: string, request: unknown): Promise<T> {
  const result = await store.extensionCall<T>("alpha", "core", { op, request })
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  return result.value
}

async function bind(store: GatewayStore, extra = {}) {
  const result = await core<RelayResult<{ binding: BindingRecord }>>(store, "bind", { principal: "test", binding: { platform: "custom", account_id: "bot", chat_id: "chat", session_durable_id: "target", ttl_seconds: null, ...extra } })
  if (result.kind !== "ok") throw new Error(JSON.stringify(result))
  return result.binding
}

test("#given the public thread SDK #when registering and calling #then it exposes the same real worker seam", async () => {
  const h = (harness = createGatewayHarness())
  const sdk = createThreadSdk({ agentDir: h.agentDir, cwd: h.agentDir, uid: 1, user: "tester", store: h.store() })
  try {
    expect((await sdk.registerStoreExtension(registration)).kind).toBe("ok")
    expect(await sdk.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "SDK" })).toEqual({ kind: "ok", value: { value: "SDK" } })
  } finally { await sdk.dispose() }
})

test("#given inbound rules #when called through tx.enqueue #then authors modes deduplication and rate limits match the relay", async () => {
  const { h, store } = await setup()
  const binding = await bind(store, { inbound_mode: "follow_up" })
  const request = { binding_id: binding.binding_id, event_id: "first", text: "hello" }
  expect(await core(store, "enqueue", { ...request, mode: "auto" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  expect(await core(store, "enqueue", { ...request, author: { platform_user_id: "", display: "Alice" } })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  expect(await core(store, "enqueue", { ...request, text: "x".repeat(1_048_577) })).toMatchObject({ kind: "error", error: { code: "message_too_large" } })
  const author = { platform_user_id: "p1", display: "Alice", user_id: "u1" }
  expect(await core(store, "enqueue", { ...request, author })).toMatchObject({ kind: "ok", deduplicated: false })
  expect(await core(store, "enqueue", { ...request, author })).toMatchObject({ kind: "ok", deduplicated: true })
  for (let i = 1; i < PAIR_BUCKET_BURST; i++) expect(await core(store, "enqueue", { ...request, event_id: `message-${i}`, author })).toMatchObject({ kind: "ok" })
  expect(await core(store, "enqueue", { ...request, event_id: "exhausted", author })).toMatchObject({ kind: "error", error: { code: "overloaded" } })
  expect(await core(store, "enqueue", { ...request, event_id: "unauthored" })).toMatchObject({ kind: "ok" })
  const rows = await store.list()
  expect(rows.map((row) => row.actor_user_id)).toEqual([...Array(PAIR_BUCKET_BURST).fill("u1"), null])
  expect(rows.every((row) => row.mode_requested === "follow_up")).toBe(true)
  expect(existsSync(join(gatewayInboxDirectory(h.agentDir, "target"), rows[0].delivery_id))).toBe(true)
})

test("#given an event delivered through a binding that was then unbound #when the extension retries it through tx.enqueue #then its stored result replays as through the relay, and a new event meets binding_inactive", async () => {
  const { store } = await setup()
  const binding = await bind(store)
  const request = { binding_id: binding.binding_id, event_id: "first", text: "hello" }
  const first = await core<{ kind: string; delivery_id?: string }>(store, "enqueue", request)
  expect(first).toMatchObject({ kind: "ok", deduplicated: false })
  expect(await core(store, "unbind", { principal: "test", binding_id: binding.binding_id, expected_revision: binding.revision })).toMatchObject({ kind: "ok" })
  expect(await core(store, "enqueue", request)).toMatchObject({ kind: "ok", deduplicated: true, delivery_id: first.delivery_id })
  expect(await core(store, "enqueue", { ...request, event_id: "second" })).toMatchObject({ kind: "error", error: { code: "binding_inactive" } })
})

test("#given binding CAS and validation #when using joined helpers #then invalid writes refuse and valid rebind unbind preserve rules", async () => {
  const { store } = await setup()
  expect(await core(store, "bind", { principal: "test", binding: { platform: "bad", account_id: "bot", chat_id: "chat", session_durable_id: "target" } })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
  const binding = await bind(store)
  expect(await core(store, "rebind", { principal: "test", binding_id: binding.binding_id, expected_revision: 8, session_durable_id: "next" })).toMatchObject({ kind: "error", error: { code: "stale_revision" } })
  expect(await core(store, "rebind", { principal: "test", binding_id: binding.binding_id, expected_revision: 1, session_durable_id: "next" })).toMatchObject({ kind: "ok", binding: { revision: 2, session_durable_id: "next", expires_at: binding.expires_at } })
  expect(await core(store, "unbind", { principal: "test", binding_id: binding.binding_id, expected_revision: 2 })).toMatchObject({ kind: "ok", binding: { status: "detached", revision: 3 } })
  expect(await core(store, "bindingFor", { platform: "custom", account_id: "bot", chat_id: "chat", thread_id: "@chat" })).toBeNull()
})

test("#given pending outbox rows #when paging and acking under the extension lock #then bounds and rollback hold without marker changes", async () => {
  const { h, store } = await setup()
  const binding = await bind(store)
  for (let i = 0; i < 3; i++) expect((await store.report({ now: h.clock.now, receipt: null, origin_delivery_ids: [], session_durable_id: "target", binding_id: binding.binding_id, event: "report", text: `report-${i}`, ui_request_id: null, ui_request_kind: null })).kind).toBe("ok")
  const marker = readFileSync(gatewayOutboxMarkerPath(h.agentDir), "utf8")
  const page = await core<RelayResult<OutboxPage>>(store, "outboxPending", { binding_id: binding.binding_id, limit: 1 })
  if (page.kind !== "ok") throw new Error(JSON.stringify(page))
  expect(page.rows.map((row) => row.text)).toEqual(["report-0"])
  expect(await store.extensionCall("alpha", "ackThenThrow", { binding_id: binding.binding_id, cursor: page.next_cursor })).toMatchObject({ kind: "refused", code: "extension_operation_failed" })
  expect(await core(store, "outboxPending", { binding_id: binding.binding_id, limit: 1 })).toMatchObject({ kind: "ok", rows: [{ text: "report-0" }] })
  expect(await core(store, "outboxAck", { binding_id: binding.binding_id, cursor: page.next_cursor })).toMatchObject({ kind: "ok", changed: true })
  const pending = await core<RelayResult<OutboxPage>>(store, "outboxPending", { binding_id: binding.binding_id, after_cursor: 0, limit: 900 })
  if (pending.kind !== "ok") throw new Error(JSON.stringify(pending))
  expect(pending.rows.map((row) => row.text)).toEqual(["report-1", "report-2"])
  expect(readFileSync(gatewayOutboxMarkerPath(h.agentDir), "utf8")).toBe(marker)
  expect(await core(store, "outboxAck", { binding_id: binding.binding_id, cursor: 999999 })).toMatchObject({ kind: "error", error: { code: "cursor_invalid" } })
})

test("#given owned tables indexes and quoted names #when migrating and renaming #then ownership follows valid schema changes", async () => {
  const { store } = await setup()
  const result = await store.registerStoreExtension({ ...registration, migrations: [
    ...registration.migrations,
    ['CREATE TABLE "alpha_audit" (id INTEGER)', "CREATE INDEX alpha_value ON alpha_items(value)"],
  ] })
  expect(result).toEqual({ kind: "ok", value: { version: 2 } })
  expect((await store.extensionCall("alpha", "put", { name: "alpha", id: 5, value: "valid" })).kind).toBe("ok")
  expect((await store.extensionCall("alpha", "sql", { sql: "INSERT INTO alpha_audit VALUES(5)" })).kind).toBe("ok")
  expect((await store.extensionCall("alpha", "sql", { sql: "ALTER TABLE alpha_audit RENAME TO alpha_renamed" })).kind).toBe("ok")
  expect(await store.extensionCall("alpha", "sql", { sql: "SELECT id FROM alpha_renamed", columns: ["id"] })).toEqual({ kind: "ok", value: [{ id: 5 }] })
  expect((await store.extensionCall("alpha", "sql", { sql: "DROP TABLE alpha_renamed" })).kind).toBe("ok")
})

test("#given mixed statements and overlapping namespaces #when accessing another namespace #then access is refused", async () => {
  const { store } = await setup()
  expect((await store.registerStoreExtension({ name: "alpha_beta", moduleUrl, migrations: [["CREATE TABLE alpha_beta_items (id INTEGER PRIMARY KEY, value TEXT)"]] })).kind).toBe("ok")
  expect(await store.extensionCall("alpha", "rows", { name: "alpha_beta" })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
  expect(await store.extensionCall("alpha", "sql", { sql: "CREATE TABLE alpha_copy (value TEXT); INSERT INTO alpha_copy SELECT sql FROM sqlite_schema" })).toMatchObject({ kind: "refused", code: "extension_schema_violation" })
})
