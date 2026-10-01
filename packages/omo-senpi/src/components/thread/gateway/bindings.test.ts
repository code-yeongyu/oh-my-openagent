import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"

import { parseThreadParams, threadToolParamSchemas } from "../contracts"
import { BINDING_DEFAULT_TTL_SECONDS, type BindInput, normalizeBindInput, WHOLE_CHAT_THREAD_ID } from "./bindings"
import { gatewayInboxDirectory } from "./paths"
import { createGatewayRelay, type GatewayRelay } from "./relay"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

function open(): GatewayHarness {
  harness = createGatewayHarness()
  return harness
}

function relayOn(h: GatewayHarness, store: GatewayStore = h.store()): GatewayRelay {
  return createGatewayRelay({ store, engine: h.engineFor(store), endpoints: { wake: async () => ({ admitted: [] }) }, locate: async () => null, now: () => h.clock.now })
}

function thread(session: string, extra: Partial<BindInput> = {}): BindInput {
  return { platform: "custom", account_id: "qa", chat_id: "c1", thread_id: "t1", session_durable_id: session, ...extra }
}

function ok<T extends { kind: string }>(result: T): Extract<T, { kind: "ok" }> {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
  return result as Extract<T, { kind: "ok" }>
}

function code(result: { kind: string; error?: { code: string } }): string {
  return result.kind === "ok" ? "ok" : (result.error?.code ?? "?")
}

describe("binding_uniqueness_revision_expiry_and_replay", () => {
  test("#given two store workers #when they attach two sessions to one thread at the same moment #then exactly one binding is active and the other call is binding_conflict", async () => {
    const h = open()
    const [first, second] = [relayOn(h), relayOn(h)]
    const outcomes = await Promise.all([
      first.bind({ principal: "session:A", binding: thread("B") }),
      second.bind({ principal: "session:A", binding: thread("C") }),
    ])
    expect(outcomes.map(code).sort()).toEqual(["binding_conflict", "ok"])
    const winner = ok(outcomes.find((outcome) => outcome.kind === "ok") ?? outcomes[0])
    const loser = outcomes.find((outcome) => outcome.kind !== "ok")
    expect(loser).toMatchObject({ error: { details: { binding_id: winner.binding.binding_id } } })
    const active = ok(await first.bindings({ filter: { status: "active" } }))
    expect(active.bindings.map((binding) => binding.binding_id)).toEqual([winner.binding.binding_id])
  })

  test("#given a bind under an idempotency key #when it is replayed with the same arguments and then with different ones #then the replay returns the same binding and the change is idempotency_conflict", async () => {
    const h = open()
    const relay = relayOn(h)
    const first = ok(await relay.bind({ principal: "session:A", idempotency_key: "k-1", binding: thread("B") }))
    const replay = ok(await relay.bind({ principal: "session:A", idempotency_key: "k-1", binding: thread("B") }))
    expect({ id: replay.binding.binding_id, deduplicated: replay.deduplicated, first: first.deduplicated }).toEqual({ id: first.binding.binding_id, deduplicated: true, first: false })
    expect(code(await relay.bind({ principal: "session:A", idempotency_key: "k-1", binding: thread("B", { ttl_seconds: 60 }) }))).toBe("idempotency_conflict")
    expect(code(await relay.bind({ principal: "session:Z", idempotency_key: "k-1", binding: thread("B") }))).toBe("binding_conflict")
    expect(ok(await relay.bindings({ filter: {} })).bindings).toHaveLength(1)
  })

  test("#given a bound thread #when the same bare thread id is bound in another chat or account #then neither collides", async () => {
    const h = open()
    const relay = relayOn(h)
    ok(await relay.bind({ principal: "session:A", binding: thread("B") }))
    ok(await relay.bind({ principal: "session:A", binding: thread("C", { chat_id: "c2" }) }))
    ok(await relay.bind({ principal: "session:A", binding: thread("D", { account_id: "other" }) }))
    ok(await relay.bind({ principal: "session:A", binding: thread("E", { platform: "discord" }) }))
    expect(ok(await relay.bindings({ filter: { thread_id: "t1", status: "active" } })).bindings.map((binding) => binding.session_durable_id).sort()).toEqual(["B", "C", "D", "E"])
  })

  test("#given the Notion and Feishu connectors #when a thread is bound on each by its native platform name #then the tool schema takes the name and the store keeps it", async () => {
    const h = open()
    const relay = relayOn(h)
    for (const platform of ["notion", "feishu"] as const) {
      expect(parseThreadParams(threadToolParamSchemas.thread_bind, { platform, account_id: "qa", chat_id: "c1" }).kind).toBe("ok")
      ok(await relay.bind({ principal: "session:A", binding: thread(`S-${platform}`, { platform }) }))
    }
    expect(ok(await relay.bindings({ filter: { status: "active" } })).bindings.map((binding) => binding.platform).sort()).toEqual(["feishu", "notion"])
  })

  test("#given identifiers carrying a C1 control or a Unicode line separator #when a thread is bound with them #then the bind is invalid_arguments and nothing is stored", async () => {
    const h = open()
    const relay = relayOn(h)
    const refused = []
    for (const account_id of ["bot\u0085acct", "bot\u009bacct", "bot\u2028acct", "bot\u2029acct"]) refused.push(code(await relay.bind({ principal: "session:A", binding: thread("B", { account_id }) })))
    expect(refused).toEqual(["invalid_arguments", "invalid_arguments", "invalid_arguments", "invalid_arguments"])
    expect(ok(await relay.bindings({ filter: {} })).bindings).toEqual([])
  })

  test("#given a binding at revision 1 #when unbind and rebind name a stale revision #then both are stale_revision; the right revision detaches, lists in-flight work, and a second unbind replays success", async () => {
    const h = open()
    h.session("B", { online: false })
    const relay = relayOn(h)
    const bound = ok(await relay.bind({ principal: "session:A", binding: thread("B") })).binding
    const inbound = await relay.inbound({ binding_id: bound.binding_id, event_id: "m-1", text: "hi" })
    expect(inbound).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
    expect(code(await relay.unbind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 2 }))).toBe("stale_revision")
    expect(code(await relay.rebind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 2, session_durable_id: "C" }))).toBe("stale_revision")
    const detached = ok(await relay.unbind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 1 }))
    expect({ status: detached.binding.status, revision: detached.binding.revision, in_flight: detached.in_flight, already: detached.already_closed }).toEqual({
      status: "detached",
      revision: 2,
      in_flight: [(inbound as { delivery_id: string }).delivery_id],
      already: false,
    })
    const again = ok(await relay.unbind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 1 }))
    expect({ status: again.binding.status, revision: again.binding.revision, already: again.already_closed }).toEqual({ status: "detached", revision: 2, already: true })
    expect(code(await relay.inbound({ binding_id: bound.binding_id, event_id: "m-2", text: "late" }))).toBe("binding_inactive")
  })

  test("#given a binding with a 60 s TTL #when the injected clock passes it #then the binding reads expired, refuses inbound and rebind, and the thread can be bound again; a rebind before expiry never extends the TTL", async () => {
    const h = open()
    h.session("B")
    h.session("C")
    const relay = relayOn(h)
    const bound = ok(await relay.bind({ principal: "session:A", binding: thread("B", { ttl_seconds: 60 }) })).binding
    expect(bound.expires_at).toBe(new Date(h.clock.now + 60_000).toISOString())
    h.clock.now += 30_000
    const moved = ok(await relay.rebind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 1, session_durable_id: "C" })).binding
    expect({ revision: moved.revision, expires_at: moved.expires_at, lease: moved.lease_started_at }).toEqual({ revision: 2, expires_at: bound.expires_at, lease: new Date(h.clock.now).toISOString() })
    h.clock.now += 30_001
    expect(ok(await relay.bindings({ filter: { chat_id: "c1" } })).bindings.map((binding) => binding.status)).toEqual(["expired"])
    expect(code(await relay.inbound({ binding_id: bound.binding_id, event_id: "m-1", text: "too late" }))).toBe("binding_inactive")
    expect(code(await relay.rebind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 2, session_durable_id: "B" }))).toBe("binding_inactive")
    const rebound = ok(await relay.bind({ principal: "session:A", binding: thread("B") })).binding
    expect({ status: rebound.status, ttl: rebound.ttl_seconds }).toEqual({ status: "active", ttl: BINDING_DEFAULT_TTL_SECONDS })
  })

  test("#given work queued for B under revision 1 #when the binding is rebound to C #then the queued work is refused binding_closed and never reaches C, and B's inbox marker is gone", async () => {
    const h = open()
    const b = h.session("B", { online: false })
    const c = h.session("C")
    const relay = relayOn(h)
    const bound = ok(await relay.bind({ principal: "session:A", binding: thread("B") })).binding
    const queued = await relay.inbound({ binding_id: bound.binding_id, event_id: "m-1", text: "for B" })
    const deliveryId = (queued as { delivery_id: string }).delivery_id
    expect(existsSync(gatewayInboxDirectory(h.agentDir, "B")) && readdirSync(gatewayInboxDirectory(h.agentDir, "B"))).toEqual([deliveryId])
    const moved = ok(await relay.rebind({ principal: "session:A", binding_id: bound.binding_id, expected_revision: 1, session_durable_id: "C" }))
    expect(moved.closed).toEqual([deliveryId])
    expect((await b.store.deliveryView(deliveryId))?.row).toMatchObject({ state: "refused", reason: "binding_closed", target_durable_id: "B" })
    expect(readdirSync(gatewayInboxDirectory(h.agentDir, "B"))).toEqual([])
    b.online = true
    await b.drain.drain({ reason: "start" })
    await h.quiesce()
    expect(b.runtime.enqueueCalls).toEqual([])
    expect(await c.store.list({ target_durable_id: "C" })).toEqual([])
    const after = await relay.inbound({ binding_id: bound.binding_id, event_id: "m-2", text: "for C" })
    expect(after).toMatchObject({ kind: "ok", thread_id: "C" })
  })

  test("#given more bindings than one page #when a bind lands between pages #then the snapshot cursor neither shifts nor duplicates, and a foreign cursor is cursor_invalid", async () => {
    const h = open()
    const relay = relayOn(h)
    for (const chat of ["c1", "c2", "c3"]) {
      ok(await relay.bind({ principal: "session:A", binding: thread("B", { chat_id: chat }) }))
      h.clock.now += 1_000
    }
    const first = ok(await relay.bindings({ filter: {}, limit: 2 }))
    expect(first.bindings.map((binding) => binding.chat_id)).toEqual(["c1", "c2"])
    ok(await relay.bind({ principal: "session:A", binding: thread("B", { chat_id: "c4" }) }))
    const second = ok(await relay.bindings({ filter: {}, limit: 2, cursor: first.next_cursor as string }))
    expect({ chats: second.bindings.map((binding) => binding.chat_id), next: second.next_cursor }).toEqual({ chats: ["c3"], next: null })
    expect(code(await relay.bindings({ filter: {}, cursor: "not-a-cursor" }))).toBe("cursor_invalid")
  })

  test("#given the closed binding schema #when a bind omits or breaks fields #then defaults apply and every broken field is invalid_arguments", () => {
    expect(normalizeBindInput({ platform: "slack", account_id: "a", chat_id: "c", session_durable_id: "B" })).toEqual({
      platform: "slack", account_id: "a", chat_id: "c", thread_id: WHOLE_CHAT_THREAD_ID, root_message_id: null, progress_message_id: null, session_durable_id: "B",
      direction: { inbound: true, outbound: true }, inbound_mode: "auto", outbound_events: ["milestone", "report", "question", "completion"], policy_id: "default", ttl_seconds: BINDING_DEFAULT_TTL_SECONDS,
    })
    expect(normalizeBindInput({ platform: "slack", account_id: "a", chat_id: "c", session_durable_id: "B", ttl_seconds: null })).toMatchObject({ ttl_seconds: null })
    const broken: readonly Partial<BindInput>[] = [
      { platform: "irc" },
      { direction: { inbound: false, outbound: false } },
      { outbound_events: ["report", "report"] },
      { outbound_events: ["broadcast"] },
      { ttl_seconds: 0 },
      { ttl_seconds: 1.5 },
      { chat_id: "" },
      { inbound_mode: "steer" },
      { direction: { inbound: false, outbound: true }, outbound_events: [] },
    ]
    for (const change of broken) {
      expect(normalizeBindInput({ platform: "slack", account_id: "a", chat_id: "c", session_durable_id: "B", ...change }), JSON.stringify(change)).toMatchObject({ kind: "refused", code: "invalid_arguments" })
    }
  })
})
