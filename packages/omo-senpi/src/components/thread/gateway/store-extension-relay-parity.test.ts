import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { gatewayInboxDirectory, gatewayRootDirectory } from "./paths"
import { createGatewayRelay } from "./relay"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/extension-lifecycle.mjs", import.meta.url).href
const bind = (session: string) => ({
  principal: "fixture", binding: { platform: "custom", account_id: "bot", chat_id: session, session_durable_id: session, ttl_seconds: null },
})

test.each([false, true])("#given target session presence %s #when relay and tx enqueue share a binding #then target validation agrees", async (present) => {
  const h = (harness = createGatewayHarness())
  if (present) h.phantom("target")
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  const relay = createGatewayRelay({ store, engine: h.engineFor(store), endpoints: { wake: async () => { throw new Error("offline") } }, locate: async () => null })
  try {
    const bound = await relay.bind(bind("target"))
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    const direct = await relay.inbound({ binding_id: bound.binding.binding_id, event_id: "direct", text: "hello" })
    const joined = await store.extensionCall("alpha", "core", { op: "enqueue", request: { binding_id: bound.binding.binding_id, event_id: "joined", text: "hello" } })
    if (present) {
      expect(direct).toMatchObject({ kind: "ok", thread_id: "target" })
      expect(joined).toMatchObject({ kind: "ok", value: { kind: "ok", thread_id: "target" } })
    } else {
      expect(direct).toMatchObject({ kind: "error", error: { code: "not_found" } })
      expect(joined).toMatchObject({ kind: "ok", value: { kind: "error", error: { code: "not_found" } } })
      expect(await store.list()).toEqual([])
    }
  } finally { relay.dispose() }
})

test("#given a blocked inbox path #when a joined enqueue's marker fails #then the operation refuses and rolls back, and the worker keeps serving", async () => {
  const h = (harness = createGatewayHarness())
  h.phantom("blocked")
  h.phantom("healthy")
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  mkdirSync(join(gatewayRootDirectory(h.agentDir), "inbox"), { recursive: true })
  const blockedPath = gatewayInboxDirectory(h.agentDir, "blocked")
  writeFileSync(blockedPath, "not a directory")
  const events: unknown[] = []
  const remove = store.onEvent((event) => events.push(event))
  try {
    const outcome = await store.extensionCall("alpha", "enqueuePair", [bind("blocked"), bind("healthy")])
    expect(outcome).toMatchObject({ kind: "refused", code: "extension_operation_failed" })
    expect(await store.list()).toEqual([])
    expect(existsSync(gatewayInboxDirectory(h.agentDir, "healthy"))).toBe(false)
    expect(events.filter((event) => typeof event === "object" && event !== null && (event as { kind?: unknown }).kind === "extension_error")).toEqual([])
  } finally { remove() }
})
