/// <reference types="bun-types" />

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createGatewayHarness, type GatewayHarness } from "../../thread/gateway/testing/harness"
import type { GatewayStore } from "../../thread/gateway/store"
import { GATEWAY_RULES_EXTENSION_NAME, GATEWAY_RULES_MIGRATIONS } from "./migrations"
import { GATEWAY_RULES_SESSION_OPS } from "./session-ops"

type DeliverySummary = { readonly kind: "ok"; readonly delivery_id: string; readonly deduplicated: boolean } | { readonly kind: "error" }
type CommittedOutcome = { readonly session_durable_id: string; readonly outcome: string; readonly delivery?: DeliverySummary }
type CommittedResult = { readonly scope: string; readonly version: string; readonly outcomes: readonly CommittedOutcome[] }

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

let buildDir: string
let moduleUrl: string

beforeAll(async () => {
  buildDir = mkdtempSync(join(tmpdir(), "omo-gateway-rules-ext-"))
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    outdir: buildDir,
    target: "bun",
    format: "esm",
    naming: "gateway-rules-extension-test.mjs",
  })
  if (!built.success) throw new Error(built.logs.map(String).join("\n"))
  moduleUrl = new URL("./gateway-rules-extension-test.mjs", pathToFileURL(`${buildDir}/`)).href
})
afterAll(() => { rmSync(buildDir, { recursive: true, force: true }) })

async function storeWithRules(h: GatewayHarness): Promise<GatewayStore> {
  const store = h.store()
  const registered = await store.registerStoreExtension({ name: GATEWAY_RULES_EXTENSION_NAME, migrations: GATEWAY_RULES_MIGRATIONS, moduleUrl, sessionCallable: GATEWAY_RULES_SESSION_OPS })
  expect(registered.kind).toBe("ok")
  return store
}

async function bindSession(store: GatewayStore, session: string, chat: string): Promise<string> {
  const bound = await store.bind({
    now: Date.now(),
    receipt: null,
    binding: {
      platform: "custom",
      account_id: "bot",
      chat_id: chat,
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
  return bound.binding.binding_id
}

const commit = (store: GatewayStore, version: string, targets: readonly unknown[]) =>
  store.extensionCall<CommittedResult>(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", { scope: "team", version, now: 1000, targets })

describe("gateway_rules store extension", () => {
  test("#given a bound session #when its chat rules commit #then blockForSession returns the rendered operating-rules block", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)
    h.phantom("sess-1")
    const bindingId = await bindSession(store, "sess-1", "chat-1")

    // when
    const committed = await commit(store, "v1", [{ session_durable_id: "sess-1", binding_id: bindingId, behavioral: ["answer in bullet points", "tag the owner on decisions"] }])

    // then
    expect(committed.kind).toBe("ok")
    const block = await store.extensionSessionAwait(GATEWAY_RULES_EXTENSION_NAME, "blockForSession", {}, { callerDurableId: "sess-1" })
    expect(block).toEqual({
      kind: "ok",
      value: {
        version: "v1",
        block: ['<operating-rules version="v1">', "- answer in bullet points", "- tag the owner on decisions", "</operating-rules>"].join("\n"),
      },
    })
  })

  test("#given a rules commit #when it repeats and a new version commits #then each session gains exactly one delivery per version", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)
    h.phantom("sess-1")
    h.phantom("sess-2")
    const binding1 = await bindSession(store, "sess-1", "chat-1")
    const binding2 = await bindSession(store, "sess-2", "chat-2")
    const targets = [
      { session_durable_id: "sess-1", binding_id: binding1, behavioral: ["rule one"] },
      { session_durable_id: "sess-2", binding_id: binding2, behavioral: ["rule one"] },
    ]

    // when
    const first = await commit(store, "v1", targets)
    const repeated = await commit(store, "v1", targets)
    const duplicated = await commit(store, "v1", [targets[0], targets[0]])
    const next = await commit(store, "v2", targets)

    // then
    expect(first.kind).toBe("ok")
    if (first.kind !== "ok") return
    expect(first.value.outcomes.map(({ outcome }) => outcome)).toEqual(["updated", "updated"])
    const firstDeliveries = first.value.outcomes.map(({ delivery }) => delivery)
    expect(firstDeliveries.every((delivery) => delivery?.kind === "ok" && delivery.deduplicated === false)).toBe(true)

    expect(repeated.kind).toBe("ok")
    if (repeated.kind !== "ok") return
    expect(repeated.value.outcomes.map(({ outcome }) => outcome)).toEqual(["unchanged", "unchanged"])
    const repeatedDeliveries = repeated.value.outcomes.map(({ delivery }) => delivery)
    expect(repeatedDeliveries.map((delivery) => delivery?.kind === "ok" && delivery.delivery_id)).toEqual(
      firstDeliveries.map((delivery) => delivery?.kind === "ok" && delivery.delivery_id),
    )
    expect(repeatedDeliveries.every((delivery) => delivery?.kind === "ok" && delivery.deduplicated === true)).toBe(true)

    expect(duplicated.kind).toBe("ok")
    if (duplicated.kind !== "ok") return
    const [asCaller, asDuplicate] = duplicated.value.outcomes
    expect(asDuplicate.delivery?.kind).toBe("ok")
    if (asCaller.delivery?.kind === "ok" && asDuplicate.delivery?.kind === "ok") {
      expect(asDuplicate.delivery.delivery_id).toBe(asCaller.delivery.delivery_id)
      expect(asDuplicate.delivery.deduplicated).toBe(true)
    }

    expect(next.kind).toBe("ok")
    if (next.kind !== "ok") return
    expect(next.value.outcomes.map(({ outcome }) => outcome)).toEqual(["updated", "updated"])
    const nextDeliveries = next.value.outcomes.map(({ delivery }) => delivery)
    for (const [index, delivery] of nextDeliveries.entries()) {
      if (delivery?.kind === "ok" && firstDeliveries[index]?.kind === "ok") {
        expect(delivery.delivery_id).not.toBe(firstDeliveries[index].delivery_id)
      }
    }
  })

  test("#given a committed block #when a later commit clears the session #then the block row is removed without a delivery", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)
    h.phantom("sess-1")
    const bindingId = await bindSession(store, "sess-1", "chat-1")
    await commit(store, "v1", [{ session_durable_id: "sess-1", binding_id: bindingId, behavioral: ["rule one"] }])

    // when
    const cleared = await commit(store, "v2", [{ session_durable_id: "sess-1", binding_id: bindingId, behavioral: null }])

    // then
    expect(cleared).toEqual({ kind: "ok", value: { scope: "team", version: "v2", outcomes: [{ session_durable_id: "sess-1", outcome: "removed" }] } })
    const block = await store.extensionSessionAwait(GATEWAY_RULES_EXTENSION_NAME, "blockForSession", {}, { callerDurableId: "sess-1" })
    expect(block).toEqual({ kind: "ok", value: null })
  })

  test("#given malformed targets #when rulesCommitted runs #then the call is refused", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)

    // when
    const result = await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", { scope: "team", version: "v1", now: 1000, targets: [{ session_durable_id: 42, behavioral: [] }] })

    // then
    expect(result.kind).toBe("refused")
    const block = await store.extensionSessionAwait(GATEWAY_RULES_EXTENSION_NAME, "blockForSession", {}, { callerDurableId: "42" })
    expect(block).toEqual({ kind: "ok", value: null })
  })
})

describe("sessionsWithRules", () => {
  test("#given two sessions in one scope and one in another #when the scope is listed #then exactly its two sessions are returned", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)
    h.phantom("a1")
    h.phantom("a2")
    h.phantom("b1")
    const bindingA1 = await bindSession(store, "a1", "chat-a1")
    const bindingA2 = await bindSession(store, "a2", "chat-a2")
    const bindingB1 = await bindSession(store, "b1", "chat-b1")
    await commit(store, "v1", [
      { session_durable_id: "a1", binding_id: bindingA1, behavioral: ["rule one"] },
      { session_durable_id: "a2", binding_id: bindingA2, behavioral: ["rule one"] },
    ])
    await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "rulesCommitted", { scope: "other", version: "v1", now: 1000, targets: [{ session_durable_id: "b1", binding_id: bindingB1, behavioral: ["rule one"] }] })

    // when
    const listed = await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "sessionsWithRules", { scope: "team" })

    // then
    expect(listed).toEqual({
      kind: "ok",
      value: {
        sessions: [
          { session_durable_id: "a1", version: "v1" },
          { session_durable_id: "a2", version: "v1" },
        ],
      },
    })
  })

  test("#given a missing or empty scope #when sessionsWithRules runs #then the call is refused", async () => {
    // given
    const h = (harness = createGatewayHarness())
    const store = await storeWithRules(h)

    // when + then
    expect((await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "sessionsWithRules", {})).kind).toBe("refused")
    expect((await store.extensionCall(GATEWAY_RULES_EXTENSION_NAME, "sessionsWithRules", { scope: "" })).kind).toBe("refused")
  })
})
