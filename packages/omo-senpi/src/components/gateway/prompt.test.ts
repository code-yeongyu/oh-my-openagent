/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext } from "../../extension/types"
import { createGatewayHarness, type GatewayHarness } from "../thread/gateway/testing/harness"
import type { GatewayStore } from "../thread/gateway/store"
import { createGatewayComponent } from "./index"
import { createGatewayRulesPromptHandler, type GatewayRulesStore } from "./prompt"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./store-extension/migrations"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

let buildDir: string
let moduleUrl: string

beforeAll(async () => {
  buildDir = mkdtempSync(join(tmpdir(), "omo-gateway-rules-prompt-"))
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./store-extension/index.ts", import.meta.url))],
    outdir: buildDir,
    target: "bun",
    format: "esm",
    naming: "gateway-rules-extension-test.mjs",
  })
  if (!built.success) throw new Error(built.logs.map(String).join("\n"))
  moduleUrl = new URL("./gateway-rules-extension-test.mjs", pathToFileURL(`${buildDir}/`)).href
})
afterAll(() => { rmSync(buildDir, { recursive: true, force: true }) })

const payload = (systemPrompt: string) => ({ type: "before_agent_start", systemPrompt })
const sessionCtx = (id: string) => ({ sessionManager: { getSessionId: () => id } })

const silentCtx = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } } as unknown as ComponentContext

function componentHandler(component: ReturnType<typeof createGatewayComponent>) {
  const handlers = new Map<string, (payload: unknown, eventCtx?: unknown) => unknown>()
  component.register({ on: (name: string, handler: never) => { handlers.set(name, handler); return () => undefined } } as never, silentCtx)
  const handler = handlers.get("before_agent_start")
  if (handler === undefined) throw new Error("the gateway component registers no before_agent_start handler")
  return handler as (payload: unknown, eventCtx?: unknown) => Promise<{ readonly systemPrompt: string } | undefined>
}

const testBindings = new Map<string, string>()
afterEach(() => testBindings.clear())

async function committedBlock(store: GatewayStore, session: string, version: string, behavioral: readonly string[]) {
  let bindingId = testBindings.get(session)
  if (bindingId === undefined) {
    const bound = await store.bind({
      now: Date.now(),
      receipt: null,
      binding: {
        platform: "custom",
        account_id: "bot",
        chat_id: `chat-${session}`,
        thread_id: "@chat",
        root_message_id: null,
        progress_message_id: null,
        session_durable_id: session,
        direction: { inbound: true, outbound: true },
        inbound_mode: "follow_up",
        outbound_events: ["report"],
        policy_id: "default",
        ttl_seconds: null,
      },
    })
    if (bound.kind !== "ok") throw new Error(`bind failed: ${JSON.stringify(bound)}`)
    bindingId = bound.binding.binding_id
    testBindings.set(session, bindingId)
  }
  const committed = await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", {
    scope: "team",
    version,
    now: 1000,
    targets: [{ session_durable_id: session, binding_id: bindingId, behavioral }],
  })
  if (committed.kind !== "ok") throw new Error(`rulesCommitted failed: ${JSON.stringify(committed)}`)
}

describe("gateway rules prompt handler", () => {
  test("#given a session with no committed rules #when the handler runs #then it returns undefined so the prompt passes through unchanged", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => store })

    // when + then
    expect(await handler(payload("BASE PROMPT"), sessionCtx("unbound-session"))).toBeUndefined()
  })

  test("#given a session with committed rules #when the handler runs #then the prompt keeps its content and gains the operating-rules block", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
    h.phantom("sess-1")
    await committedBlock(store, "sess-1", "v1", ["answer in bullet points"])
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => store })

    // when
    const result = await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))

    // then
    expect(result?.systemPrompt?.startsWith("BASE PROMPT\n\n")).toBe(true)
    expect(result?.systemPrompt).toContain('<operating-rules version="v1">')
    expect(result?.systemPrompt).toContain("- answer in bullet points")
  })

  test("#given committed rules #when the handler runs twice on the same version #then both prompts are byte-identical", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
    h.phantom("sess-1")
    await committedBlock(store, "sess-1", "v1", ["rule one"])
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => store })

    // when
    const first = await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))
    const second = await handler(payload(first?.systemPrompt ?? ""), sessionCtx("sess-1"))

    // then
    expect(second?.systemPrompt).toBe(first?.systemPrompt)
  })

  test("#given a new rules version #when the handler runs again #then the block is replaced, not appended", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = h.store()
    await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
    h.phantom("sess-1")
    await committedBlock(store, "sess-1", "v1", ["rule one"])
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => store })
    const first = await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))

    // when
    await committedBlock(store, "sess-1", "v2", ["rule two"])
    const second = await handler(payload(first?.systemPrompt ?? "BASE PROMPT"), sessionCtx("sess-1"))

    // then
    expect(second?.systemPrompt).toContain('version="v2"')
    expect(second?.systemPrompt).not.toContain('version="v1"')
    expect(second?.systemPrompt?.split("<!-- omo-gateway:rules:begin -->").length).toBe(2)
  })

  test("#given no gateway store #when the handler runs #then it returns undefined", async () => {
    // given
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => undefined })

    // when + then
    expect(await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))).toBeUndefined()
  })

  test("#given a lookup failure #when the handler runs #then it passes the prompt through and warns once", async () => {
    // given
    const failing: GatewayRulesStore = { extensionCall: async () => ({ kind: "refused", code: "extension_operation_failed", message: "worker died" }) }
    const warnings: string[] = []
    const handler = createGatewayRulesPromptHandler({ ensureStore: async () => failing, onLookupError: (message) => warnings.push(message) })

    // when
    expect(await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))).toBeUndefined()
    expect(await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))).toBeUndefined()

    // then
    expect(warnings.length).toBe(1)
  })
})

describe("gateway component activation", () => {
  test("#given no gateway config #when the handler runs #then it returns undefined and never opens a store", async () => {
    // given
    let storeCreations = 0
    const component = createGatewayComponent({
      loadGatewaySection: () => undefined,
      createStore: () => { storeCreations += 1; throw new Error("must not be created") },
    })
    const handler = componentHandler(component)

    // when + then
    expect(await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))).toBeUndefined()
    expect(storeCreations).toBe(0)
  })

  test("#given gateway scopes but no store database #when the handler runs #then it returns undefined and never opens a store", async () => {
    // given
    const emptyDir = mkdtempSync(join(tmpdir(), "omo-gateway-empty-"))
    let storeCreations = 0
    const component = createGatewayComponent({
      loadGatewaySection: () => ({ scopes: [{ id: "team" }] }),
      agentDir: () => emptyDir,
      createStore: () => { storeCreations += 1; throw new Error("must not be created") },
    })
    const handler = componentHandler(component)

    // when + then
    try {
      expect(await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))).toBeUndefined()
      expect(storeCreations).toBe(0)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  test("#given a configured gateway #when the handler runs for a bound session #then the component registers the extension and injects the block", async () => {
    // given: the component's own registration path (its ensureStore) is the only one in play
    const h = (harness = createGatewayHarness())
    const store = h.store()
    h.phantom("sess-1")
    const component = createGatewayComponent({
      loadGatewaySection: () => ({ scopes: [{ id: "team" }] }),
      agentDir: () => h.agentDir,
      createStore: () => store,
      resolveModuleUrl: () => moduleUrl,
    })
    const handler = componentHandler(component)
    const registered = await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl })
    if (registered.kind !== "ok") throw new Error(`register failed: ${JSON.stringify(registered)}`)
    await committedBlock(store, "sess-1", "v1", ["answer in bullet points"])

    // when
    const result = await handler(payload("BASE PROMPT"), sessionCtx("sess-1"))

    // then
    expect(result?.systemPrompt).toContain('<operating-rules version="v1">')
    expect(result?.systemPrompt).toContain("- answer in bullet points")
    expect(await handler(payload("BASE PROMPT"), sessionCtx("never-committed"))).toBeUndefined()
  })
})
