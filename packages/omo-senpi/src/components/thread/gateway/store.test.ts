import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Worker } from "node:worker_threads"

import { gatewayDatabasePath, gatewayInboxDirectory, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import type { GatewayStoreEvent } from "./types"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"
import { settled } from "./testing/settled"

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
      expect((await settled(store.journalMode())).error).toMatchObject({ code: "gateway_lock_wait_exceeded" })
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

describe("schema migration from v1", () => {
  test("#given a store written by the todo-11 schema #when the current store opens it #then its session counters survive and the incarnation is recorded", async () => {
    const h = (harness = createGatewayHarness())
    mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true, mode: 0o700 })
    const v1 = new Database(gatewayDatabasePath(h.agentDir))
    for (const statement of GATEWAY_MIGRATIONS[0]) v1.run(statement)
    v1.run("PRAGMA user_version = 1")
    v1.run("INSERT INTO session_meta (durable_id, next_seq, applied_seq) VALUES ('B', 8, 7)")
    v1.close()
    const store = h.store()
    await store.registerIncarnation({ durable_id: "B", incarnation: "runtime-1" })
    const upgraded = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      expect(upgraded.query("SELECT user_version AS v FROM pragma_user_version()").get()).toEqual({
        v: GATEWAY_MIGRATIONS.length,
      })
      expect(
        upgraded.query("SELECT next_seq, applied_seq, incarnation FROM session_meta WHERE durable_id = 'B'").get(),
      ).toEqual({ next_seq: 8, applied_seq: 7, incarnation: "runtime-1" })
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
    const item = (seq: number, message: string) => ({
      target: "B",
      message,
      message_seq: seq,
      delivery: "auto",
      operation_id: `B-${seq}`,
      accepted_at: "2026-09-28T00:00:00.000Z",
    })
    writeFileSync(
      join(legacy, "mailbox.jsonl"),
      [
        JSON.stringify({ version: 1, kind: "snapshot", next_seq: 1, items: [] }),
        JSON.stringify({ version: 1, kind: "enqueue", item: item(1, "one") }),
        JSON.stringify({ version: 1, kind: "enqueue", item: item(2, "gone") }),
        JSON.stringify({ version: 1, kind: "enqueue", item: item(3, "three") }),
        JSON.stringify({ version: 1, kind: "enqueue", item: { ...item(4, "nowhere"), target: "../not an id" } }),
        JSON.stringify({ version: 1, kind: "remove", message_seq: 2 }),
        '{"version":1,"kind":"enq',
      ].join("\n"),
    )
    const first = h.store({ legacyMailboxDirectories: [legacy] })
    const events: GatewayStoreEvent[] = []
    first.onEvent((event) => events.push(event))
    expect(await first.legacyMigrated()).toBe(2)
    expect(events.filter((event) => event.kind === "legacy_mailbox_skipped")).toEqual([
      {
        kind: "legacy_mailbox_skipped",
        directory: legacy,
        items: [{ message_seq: 4, target: "../not an id", reason: "invalid_target" }],
      },
    ])
    const second = h.store({ legacyMailboxDirectories: [legacy] })
    expect(await second.legacyMigrated()).toBe(0)
    const rows = await second.list({ target_durable_id: "B" })
    expect(rows.map((row) => [row.body, row.state, row.envelope.origin])).toEqual([
      [
        "one",
        "queued",
        {
          external: {
            platform: "legacy_mailbox",
            account_id: expect.any(String),
            chat_id: legacy,
            thread_id: "@chat",
            message_id: "B-1",
          },
        },
      ],
      [
        "three",
        "queued",
        {
          external: {
            platform: "legacy_mailbox",
            account_id: expect.any(String),
            chat_id: legacy,
            thread_id: "@chat",
            message_id: "B-3",
          },
        },
      ],
    ])
    expect(readdirSync(gatewayInboxDirectory(h.agentDir, "B")).toSorted()).toEqual(
      rows.map((row) => row.delivery_id).toSorted(),
    )
    expect(existsSync(join(legacy, "mailbox.jsonl"))).toBe(true)
    const meta = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      const record = meta.query("SELECT value FROM gateway_meta WHERE key = ?").get(`legacy_mailbox:${legacy}`) as {
        value: string
      } | null
      expect(JSON.parse(record?.value ?? "null")).toMatchObject({
        count: 2,
        skipped: [{ message_seq: 4, target: "../not an id", reason: "invalid_target" }],
      })
    } finally {
      meta.close()
    }
  })

  test("#given legacy steers for the turn the target is running and for an earlier turn #when they are imported and the target drains them #then the current one steers into the running turn and the stale one is a turn_conflict", async () => {
    // given: B is in its first turn (gateway turn_epoch 1), the legacy host's turn-1
    const h = (harness = createGatewayHarness())
    const legacy = join(h.agentDir, "cwd", ".omo", "thread-tools", "mailbox")
    mkdirSync(legacy, { recursive: true })
    const steer = (seq: number, message: string, turn: string) => ({
      target: "B",
      message,
      message_seq: seq,
      delivery: "steer",
      expected_turn_id: turn,
      operation_id: `B-${seq}`,
      accepted_at: "2026-09-28T00:00:00.000Z",
    })
    writeFileSync(
      join(legacy, "mailbox.jsonl"),
      `${[
        JSON.stringify({ version: 1, kind: "snapshot", next_seq: 1, items: [] }),
        JSON.stringify({ version: 1, kind: "enqueue", item: steer(1, "for this turn", "turn-1") }),
        JSON.stringify({ version: 1, kind: "enqueue", item: steer(2, "for an old turn", "turn-0") }),
        // Not the legacy host's spelling of a turn id: neither names turn 1.
        JSON.stringify({ version: 1, kind: "enqueue", item: steer(3, "bare digits", "1") }),
        JSON.stringify({ version: 1, kind: "enqueue", item: steer(4, "leading zero", "turn-01") }),
      ].join("\n")}\n`,
    )
    const b = h.session("B", { storeOptions: { legacyMailboxDirectories: [legacy] } })
    b.runtime.beginUserTurn()

    // when
    expect(await b.store.legacyMigrated()).toBe(4)
    await b.drain.drain({ reason: "inbox" })
    b.runtime.toolBoundary()
    await h.quiesce()

    // then
    const rows = await b.store.list({ target_durable_id: "B" })
    expect(rows.map((row) => [row.body, row.state, row.reason])).toEqual([
      ["for this turn", "applied", null],
      ["for an old turn", "refused", "turn_conflict"],
      ["bare digits", "refused", "turn_conflict"],
      ["leading zero", "refused", "turn_conflict"],
    ])
    expect(b.runtime.enqueueCalls.map((call) => [call.delivery_id, call.lane])).toEqual([
      [rows[0]?.delivery_id, "steer"],
    ])
  })
})
