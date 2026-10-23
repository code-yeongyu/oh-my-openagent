import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createGatewayHarness, type GatewayHarness } from "../thread/gateway/testing/harness"
import { gatewayDatabasePath } from "../thread/gateway/paths"
import { createGatewayComponent } from "./index"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

let buildDir: string
let moduleUrl: string
let harness: GatewayHarness | undefined
beforeAll(async () => {
  buildDir = mkdtempSync(join(tmpdir(), "rules-preview-"))
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./store-extension/index.ts", import.meta.url))],
    outdir: buildDir, target: "bun", format: "esm", naming: "rules.mjs",
  })
  expect(built.success).toBe(true)
  moduleUrl = pathToFileURL(join(buildDir, "rules.mjs")).href
})
afterEach(async () => { await harness?.dispose(); harness = undefined })
afterAll(() => rmSync(buildDir, { recursive: true, force: true }))

function snapshot(dir: string): unknown {
  // WAL read marks in -shm are coordination metadata, not semantic database state.
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== "gateway.sqlite-shm").map((entry) => {
    const path = join(dir, entry.name)
    return [entry.name, entry.isDirectory() ? snapshot(path) : readFileSync(path).toString("base64")]
  })
}

function semanticRows(agentDir: string) {
  const db = new Database(gatewayDatabasePath(agentDir), { readonly: true })
  try {
    return {
      blocks: db.query("SELECT * FROM gateway_rules_blocks ORDER BY session_durable_id").all(),
      extensions: db.query("SELECT * FROM extension_schema ORDER BY name").all(),
    }
  } finally {
    db.close()
  }
}

test("#given committed gateway rules #when previewed before first use #then the real addition is returned without opening a worker or changing disk state", async () => {
  // given
  const h = harness = createGatewayHarness()
  const store = h.store()
  expect((await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })).kind).toBe("ok")
  expect((await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", {
    scope: "preview", version: "v1", now: 1,
    targets: [{ session_durable_id: "preview", behavioral: ["fixture behavior"] }],
  })).kind).toBe("ok")
  const pi = new FakeExtensionAPI()
  let creations = 0
  let registrations = 0
  const warnings: string[] = []
  createGatewayComponent({
    agentDir: () => h.agentDir, loadGatewaySection: () => ({ scopes: [{ id: "preview" }] }),
    resolveModuleUrl: () => moduleUrl,
    createStore: () => {
      creations += 1
      return {
        extensionCall: store.extensionCall,
        registerStoreExtension: (descriptor) => { registrations += 1; return store.registerStoreExtension(descriptor) },
      }
    },
  }).register(pi, { logger: { info() {}, error() {}, warn: (message) => warnings.push(message) }, config: { getFlag: () => undefined } })
  const ctx = { sessionManager: { getSessionId: () => "preview" } }
  const event = { type: "before_agent_start", systemPrompt: "BASE" }
  const rows = semanticRows(h.agentDir)
  const before = snapshot(h.agentDir)
  // when
  const preview = await pi.dispatch("before_agent_start", { ...event, preview: true }, ctx)
  // then
  expect(creations).toBe(0)
  expect(registrations).toBe(0)
  expect(warnings).toEqual([])
  expect(snapshot(h.agentDir)).toEqual(before)
  expect(semanticRows(h.agentDir)).toEqual(rows)
  expect(h.wakes).toEqual([])
  expect(pi.messages).toEqual([])
  const real = await pi.dispatch("before_agent_start", event, ctx)
  expect(real[0]).toEqual({ systemPrompt: expect.any(String) })
  expect(preview).toEqual(real)
  expect(creations).toBe(1)
  expect(registrations).toBe(1)
})

test("#given initially absent gateway config #when previewed before enabling it #then no settled latch suppresses the real registration", async () => {
  // given
  const h = harness = createGatewayHarness()
  const store = h.store()
  await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
  let enabled = false
  let creations = 0
  const pi = new FakeExtensionAPI()
  createGatewayComponent({
    agentDir: () => h.agentDir, loadGatewaySection: () => enabled ? { scopes: ["preview"] } : undefined,
    resolveModuleUrl: () => moduleUrl, createStore: () => { creations += 1; return store },
  }).register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
  const event = { type: "before_agent_start", systemPrompt: "BASE" }
  const ctx = { sessionManager: { getSessionId: () => "preview" } }
  // when
  await pi.dispatch("before_agent_start", { ...event, preview: true }, ctx)
  enabled = true
  await pi.dispatch("before_agent_start", event, ctx)
  // then
  expect(creations).toBe(1)
})

test("#given an already activated gateway #when previewed after config changes #then its bound store still supplies the real addition without mutation", async () => {
  // given
  const h = harness = createGatewayHarness()
  const store = h.store()
  await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
  await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", {
    scope: "preview", version: "v1", now: 1,
    targets: [{ session_durable_id: "preview", behavioral: ["fixture behavior"] }],
  })
  let configured = true
  let creations = 0
  const pi = new FakeExtensionAPI()
  createGatewayComponent({
    agentDir: () => h.agentDir,
    loadGatewaySection: () => configured ? { scopes: ["preview"] } : undefined,
    resolveModuleUrl: () => moduleUrl,
    createStore: () => { creations += 1; return store },
  }).register(pi, { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } })
  const event = { type: "before_agent_start", systemPrompt: "BASE" }
  const ctx = { sessionManager: { getSessionId: () => "preview" } }
  const real = await pi.dispatch("before_agent_start", event, ctx)
  expect(real[0]).toEqual({ systemPrompt: expect.any(String) })
  configured = false
  const rows = semanticRows(h.agentDir)
  const before = snapshot(h.agentDir)
  // when
  const preview = await pi.dispatch("before_agent_start", { ...event, preview: true }, ctx)
  // then
  expect(preview).toEqual(real)
  expect(snapshot(h.agentDir)).toEqual(before)
  expect(semanticRows(h.agentDir)).toEqual(rows)
  expect(creations).toBe(1)
})
