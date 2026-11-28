import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { gatewayDatabasePath } from "./paths"
import { GATEWAY_MIGRATIONS, GATEWAY_READER_FLOOR_KEY } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

// Row 25 of #15221 (slice A): the store keeps who opened a thread and on which device, so a thread knows its opener
// and an opener lists its children. The relation is written on the opener's device and on the hosting device; keys are
// durable session ids, the device columns are hints, so a store restored under a new device id still resolves.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

test("#given a creation recorded with both devices #when reading it back #then the child names its opener and the opener lists the child", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.recordThreadCreation({
    creator_durable_id: "lead",
    created_durable_id: "child",
    creator_device: "dev-a",
    created_device: "dev-b",
  })
  expect(await store.threadOpener("child")).toEqual({
    creator_durable_id: "lead",
    creator_device: "dev-a",
    created_at: h.clock.now,
  })
  expect(await store.threadChildren("lead")).toEqual([
    { created_durable_id: "child", created_device: "dev-b", created_at: h.clock.now },
  ])
  expect(await store.threadOpener("lead")).toBeUndefined()
  expect(await store.threadChildren("child")).toEqual([])
})

test("#given the opener's device and the hosting device both record one creation #when listing #then it is one child, not two", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  const record = { creator_durable_id: "lead", created_durable_id: "child", creator_device: "dev-a", created_device: "dev-b" }
  await store.recordThreadCreation(record)
  await store.recordThreadCreation(record)
  expect((await store.threadChildren("lead")).map((row) => row.created_durable_id)).toEqual(["child"])
})

test("#given a recorded creation #when the store reopens (host restart) #then opener and children still resolve", async () => {
  const h = (harness = createGatewayHarness())
  const first = h.store()
  await first.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child", creator_device: "dev-a" })
  await first.dispose()
  const second = h.store()
  expect(await second.threadOpener("child")).toMatchObject({ creator_durable_id: "lead", creator_device: "dev-a" })
  expect((await second.threadChildren("lead")).map((row) => row.created_durable_id)).toEqual(["child"])
})

test("#given a store at the previous schema holding a creation #when the new build opens it #then the row resolves with no device and the reader floor does not move", async () => {
  const h = (harness = createGatewayHarness())
  const path = gatewayDatabasePath(h.agentDir)
  mkdirSync(dirname(path), { recursive: true })
  const previous = GATEWAY_MIGRATIONS.length - 1
  const db = new Database(path)
  try {
    db.exec("PRAGMA journal_mode = WAL")
    for (const step of GATEWAY_MIGRATIONS.slice(0, previous)) for (const statement of step) db.exec(statement)
    db.exec(`PRAGMA user_version = ${previous}`)
    db.exec("INSERT INTO thread_creations (creator_durable_id, created_durable_id, created_at) VALUES ('lead', 'child', 7)")
  } finally {
    db.close()
  }
  const store = h.store()
  expect(await store.threadOpener("child")).toEqual({ creator_durable_id: "lead", creator_device: null, created_at: 7 })
  expect(await store.threadChildren("lead")).toEqual([{ created_durable_id: "child", created_device: null, created_at: 7 }])
  const check = new Database(path, { readonly: true })
  try {
    const floor = check.query("SELECT value FROM gateway_meta WHERE key = ?").get(GATEWAY_READER_FLOOR_KEY) as {
      value: string
    } | null
    expect(Number(floor?.value)).toBe(14)
  } finally {
    check.close()
  }
})

test("#given a child #when its opener hands it to another thread #then the new opener lists it, the old one does not, and the row names who handed it over", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child", creator_device: "dev-a" })
  expect(
    await store.handOverThread({ created_durable_id: "child", from_durable_id: "lead", to_durable_id: "heir", to_device: "dev-c" }),
  ).toEqual({ kind: "ok" })
  expect(await store.threadOpener("child")).toMatchObject({ creator_durable_id: "heir", creator_device: "dev-c" })
  expect(await store.threadChildren("lead")).toEqual([])
  expect(await store.threadChildren("heir")).toEqual([expect.objectContaining({ created_durable_id: "child" })])
})

test("#given a child #when a thread that did not open it hands it over #then the store refuses not_creator and the opener stays", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child" })
  expect(
    await store.handOverThread({ created_durable_id: "child", from_durable_id: "stranger", to_durable_id: "heir" }),
  ).toMatchObject({ kind: "refused", code: "not_creator" })
  expect(await store.threadOpener("child")).toMatchObject({ creator_durable_id: "lead" })
})

test("#given a metadata value at the 4 KB ceiling #when it is set and the store reopens #then it reads back unchanged", async () => {
  const h = (harness = createGatewayHarness())
  const first = h.store()
  const value = { note: "x".repeat(4096 - JSON.stringify({ note: "" }).length) }
  expect(JSON.stringify(value)).toHaveLength(4096)
  expect(await first.setThreadMetadata({ durable_id: "child", value, updated_by: "lead" })).toEqual({ kind: "ok" })
  await first.dispose()
  expect(await h.store().threadMetadata("child")).toEqual({ value, updated_by: "lead", updated_at: h.clock.now })
})

test("#given a metadata value under 4 KB in characters but over it in UTF-8 bytes #when it is set #then it is refused, never cut, and the earlier value stays", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store()
  await store.setThreadMetadata({ durable_id: "child", value: { v: 1 }, updated_by: "lead" })
  const over = { note: "é".repeat(2046) }
  expect(new TextEncoder().encode(JSON.stringify(over)).length).toBe(4103)
  expect(await store.setThreadMetadata({ durable_id: "child", value: over, updated_by: "lead" })).toEqual({
    kind: "refused",
    code: "metadata_too_large",
    bytes: 4103,
    limit: 4096,
  })
  expect(await store.threadMetadata("child")).toMatchObject({ value: { v: 1 } })
})
