import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createInboxDrain } from "./drain"
import { gatewayDatabasePath, gatewayInboxDirectory, gatewayRootDirectory } from "./paths"
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
    expect({
      database: statSync(gatewayDatabasePath(h.agentDir)).mode & 0o777,
      directory: statSync(gatewayRootDirectory(h.agentDir)).mode & 0o777,
    }).toEqual({ database: 0o600, directory: 0o700 })
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
      JSON.stringify({ version: 1, kind: "remove", message_seq: 2 }),
      "{\"version\":1,\"kind\":\"enq",
    ].join("\n"))
    const first = h.store({ legacyMailboxDirectories: [legacy] })
    expect(await first.legacyMigrated()).toBe(2)
    const second = h.store({ legacyMailboxDirectories: [legacy] })
    expect(await second.legacyMigrated()).toBe(0)
    const rows = await second.list({ target_durable_id: "B" })
    expect(rows.map((row) => [row.body, row.state, row.envelope.origin])).toEqual([
      ["one", "queued", { external: { platform: "legacy_mailbox", account_id: expect.any(String), chat_id: legacy, thread_id: "@chat", message_id: "B-1" } }],
      ["three", "queued", { external: { platform: "legacy_mailbox", account_id: expect.any(String), chat_id: legacy, thread_id: "@chat", message_id: "B-3" } }],
    ])
    expect(readdirSync(gatewayInboxDirectory(h.agentDir, "B")).toSorted()).toEqual(rows.map((row) => row.delivery_id).toSorted())
    expect(existsSync(join(legacy, "mailbox.jsonl"))).toBe(true)
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
