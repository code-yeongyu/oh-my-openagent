import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Worker } from "node:worker_threads"

import { createInboxDrain } from "./drain"
import { gatewayDatabasePath, gatewayInboxDirectory, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import type { GatewayStoreEvent } from "./types"
import { FakeSessionRuntime } from "./testing/fake-runtime"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

describe("gateway store file", () => {
  test("#given an isolated agent dir #when the store opens #then gateway.sqlite is 0600 in a 0700 dir and runs in WAL mode", async () => {
    const h = (harness = createGatewayHarness())
    const store = h.store()
    expect(await store.journalMode()).toBe("wal")
    // win32 has no POSIX permission bits to assert: chmod there only toggles the read-only flag
    if (process.platform === "win32") return
    expect({
      database: statSync(gatewayDatabasePath(h.agentDir)).mode & 0o777,
      directory: statSync(gatewayRootDirectory(h.agentDir)).mode & 0o777,
    }).toEqual({ database: 0o600, directory: 0o700 })
  })
})

describe("store open recovery", () => {
  test("#given another connection holds the write lock through the first open #when the lock is released #then the next call opens the store instead of replaying the cached failure", async () => {
    const h = (harness = createGatewayHarness())
    mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true, mode: 0o700 })
    const holder = new Database(gatewayDatabasePath(h.agentDir))
    holder.run("BEGIN IMMEDIATE")
    const store = h.store({ _test: { busyTimeoutMs: 20, lockWaitMaxMs: 150 } })
    try {
      await expect(store.journalMode()).rejects.toMatchObject({ code: "gateway_lock_wait_exceeded" })
    } finally {
      holder.run("COMMIT")
      holder.close()
    }
    expect(await store.journalMode()).toBe("wal")
  })

  test("#given an open store whose worker died #when the next call runs #then a fresh worker serves it", async () => {
    const h = (harness = createGatewayHarness())
    const workers: Worker[] = []
    const store = h.store({ _test: { onWorkerStarted: (worker) => workers.push(worker) } })
    expect(await store.journalMode()).toBe("wal")
    const first = workers[0]
    if (first === undefined) throw new Error("no worker started")
    const exited = new Promise<number>((resolve) => first.once("exit", resolve))
    await first.terminate()
    await exited
    expect(await store.journalMode()).toBe("wal")
    expect(workers.length).toBe(2)
  })
})

describe("schema migration v1 -> v2", () => {
  test("#given a store written by the todo-11 schema #when the current store opens it #then its deliveries survive, the relay tables exist, and a question can be asked and answered", async () => {
    const h = (harness = createGatewayHarness())
    mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true, mode: 0o700 })
    const v1 = new Database(gatewayDatabasePath(h.agentDir))
    for (const statement of GATEWAY_MIGRATIONS[0]) v1.run(statement)
    v1.run("PRAGMA user_version = 1")
    v1.run("INSERT INTO session_meta (durable_id, next_seq, applied_seq) VALUES ('B', 8, 7)")
    v1.close()
    const store = h.store()
    const bound = await store.bind({ now: h.clock.now, receipt: null, binding: { platform: "telegram", account_id: "bot", chat_id: "c", thread_id: "@chat", root_message_id: null, progress_message_id: null, session_durable_id: "B", direction: { inbound: true, outbound: true }, inbound_mode: "follow_up", outbound_events: ["question"], policy_id: "default", ttl_seconds: null } })
    if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
    expect(bound.binding.session_realm_id).toMatch(/^realm-[0-9a-f]{32}$/)
    const asked = await store.report({ now: h.clock.now, receipt: null, origin_delivery_id: null, session_durable_id: "B", binding_id: bound.binding.binding_id, event: "question", text: "ok?", ui_request_id: "ui-1", ui_request_kind: null })
    if (asked.kind !== "ok") throw new Error(JSON.stringify(asked))
    expect(await store.claimAnswer({ now: h.clock.now, binding_id: bound.binding.binding_id, reply_token: asked.reply_token as string, answer: "yes" })).toMatchObject({ kind: "ok", ui_request_id: "ui-1", session_durable_id: "B" })
    await store.registerIncarnation({ durable_id: "B", incarnation: "runtime-1" })
    const upgraded = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      expect(upgraded.query("SELECT user_version AS v FROM pragma_user_version()").get()).toEqual({ v: GATEWAY_MIGRATIONS.length })
      expect(upgraded.query("SELECT next_seq, applied_seq, incarnation FROM session_meta WHERE durable_id = 'B'").get()).toEqual({ next_seq: 8, applied_seq: 7, incarnation: "runtime-1" })
    } finally {
      upgraded.close()
    }
  })
})

describe("schema migration v3 -> v4", () => {
  test("#given a v3 store holding an answered question #when the current store opens it #then the row keeps its answer and state, and reads answered_by null", async () => {
    const h = (harness = createGatewayHarness())
    mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true, mode: 0o700 })
    const v3 = new Database(gatewayDatabasePath(h.agentDir))
    for (const step of GATEWAY_MIGRATIONS.slice(0, 3)) for (const statement of step) v3.run(statement)
    v3.run("PRAGMA user_version = 3")
    v3.run("INSERT INTO bindings (binding_id, revision, status, platform, account_id, chat_id, thread_id, session_realm_id, session_durable_id, direction_inbound, direction_outbound, inbound_mode, outbound_events, policy_id, created_at, updated_at, lease_started_at) VALUES ('bnd-1', 1, 'active', 'slack', 'bot', 'c', '@chat', 'realm-x', 'B', 1, 1, 'auto', '[\"question\"]', 'default', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')")
    v3.run("INSERT INTO outbox (binding_id, revision, event_kind, payload, state, created_at, session_durable_id, reply_token, ui_request_id, question_state, answer, answered_at, answer_state) VALUES ('bnd-1', 1, 'question', '{\"text\":\"ok?\"}', 'pending', 1, 'B', 'rt-old', 'ui-0', 'answered', 'yes', 2, 'delivered')")
    v3.close()
    const store = h.store()
    const page = await store.readOutbox({ now: h.clock.now, binding_id: "bnd-1" })
    if (page.kind !== "ok") throw new Error(JSON.stringify(page))
    expect(page.rows.map((row) => ({ text: row.text, question_state: row.question_state, answered_by: row.answered_by }))).toEqual([{ text: "ok?", question_state: "answered", answered_by: null }])
    const upgraded = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      expect(upgraded.query("SELECT user_version AS v FROM pragma_user_version()").get()).toEqual({ v: GATEWAY_MIGRATIONS.length })
      expect(upgraded.query("SELECT answer, answered_at, answer_state, answered_by FROM outbox WHERE reply_token = 'rt-old'").get()).toEqual({ answer: "yes", answered_at: 2, answer_state: "delivered", answered_by: null })
    } finally {
      upgraded.close()
    }
  })
})

describe("legacy mailbox migration", () => {
  test("#given a legacy sender-local mailbox journal #when the store opens twice #then its pending items become queued rows once, in order, and the directory is left in place", async () => {
    const h = (harness = createGatewayHarness())
    const legacy = join(h.agentDir, "cwd", ".omo", "thread-tools", "mailbox")
    mkdirSync(legacy, { recursive: true })
    const item = (seq: number, message: string) => ({ target: "B", message, message_seq: seq, delivery: "auto", operation_id: `B-${seq}`, accepted_at: "2026-09-28T00:00:00.000Z" })
    writeFileSync(join(legacy, "mailbox.jsonl"), [
      JSON.stringify({ version: 1, kind: "snapshot", next_seq: 1, items: [] }),
      JSON.stringify({ version: 1, kind: "enqueue", item: item(1, "one") }),
      JSON.stringify({ version: 1, kind: "enqueue", item: item(2, "gone") }),
      JSON.stringify({ version: 1, kind: "enqueue", item: item(3, "three") }),
      JSON.stringify({ version: 1, kind: "enqueue", item: { ...item(4, "nowhere"), target: "../not an id" } }),
      JSON.stringify({ version: 1, kind: "remove", message_seq: 2 }),
      "{\"version\":1,\"kind\":\"enq",
    ].join("\n"))
    const first = h.store({ legacyMailboxDirectories: [legacy] })
    const events: GatewayStoreEvent[] = []
    first.onEvent((event) => events.push(event))
    expect(await first.legacyMigrated()).toBe(2)
    expect(events.filter((event) => event.kind === "legacy_mailbox_skipped")).toEqual([{ kind: "legacy_mailbox_skipped", directory: legacy, items: [{ message_seq: 4, target: "../not an id", reason: "invalid_target" }] }])
    const second = h.store({ legacyMailboxDirectories: [legacy] })
    expect(await second.legacyMigrated()).toBe(0)
    const rows = await second.list({ target_durable_id: "B" })
    expect(rows.map((row) => [row.body, row.state, row.envelope.origin])).toEqual([
      ["one", "queued", { external: { platform: "legacy_mailbox", account_id: expect.any(String), chat_id: legacy, thread_id: "@chat", message_id: "B-1" } }],
      ["three", "queued", { external: { platform: "legacy_mailbox", account_id: expect.any(String), chat_id: legacy, thread_id: "@chat", message_id: "B-3" } }],
    ])
    expect(readdirSync(gatewayInboxDirectory(h.agentDir, "B")).toSorted()).toEqual(rows.map((row) => row.delivery_id).toSorted())
    expect(existsSync(join(legacy, "mailbox.jsonl"))).toBe(true)
    const meta = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      const record = meta.query("SELECT value FROM gateway_meta WHERE key = ?").get(`legacy_mailbox:${legacy}`) as { value: string } | null
      expect(JSON.parse(record?.value ?? "null")).toMatchObject({ count: 2, skipped: [{ message_seq: 4, target: "../not an id", reason: "invalid_target" }] })
    } finally {
      meta.close()
    }
  })
})

describe("release_session requeue", () => {
  test("#given a host dropped an admitted delivery when it released the session #when it is requeued #then the next owner applies it exactly once", async () => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = h.session("B")
    b.runtime.beginUserTurn()
    const result = await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "move me" })
    if (result.kind !== "ok") throw new Error(JSON.stringify(result))
    const id = result.delivery_id
    expect((await b.store.deliveryView(id))?.row.state).toBe("admitted")
    expect(b.runtime.dropQueues()).toEqual([id])
    expect(await b.store.requeueReleased({ now: h.clock.now, target_durable_id: "B", delivery_ids: [id] })).toEqual([id])
    expect(existsSync(join(gatewayInboxDirectory(h.agentDir, "B"), id))).toBe(true)
    const runtime = new FakeSessionRuntime(b.runtime.sessionPath, "B", h.agentDir, { reopen: true })
    const drain = createInboxDrain({ store: h.store(), runtime, durableId: "B", sessionPath: () => runtime.sessionPath })
    const emitted = new Promise<string>((resolve) => runtime.onEmitted(resolve))
    expect((await drain.drain({ reason: "start" })).admitted).toEqual([{ delivery_id: id, kind: "started" }])
    expect(await emitted).toBe(id)
    await drain.drain({ reason: "emitted" })
    expect({ state: (await b.store.deliveryView(id))?.row.state, entries: runtime.transcriptEntries(id) }).toEqual({ state: "applied", entries: 1 })
  })
})
