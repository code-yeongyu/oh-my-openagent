import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { METADATA_CONTEXT_KEY, OPENED_BY_CONTEXT_KEY, OPENED_BY_ENTRY, registerOpenedBy } from "./opened-by"

// #15221 row 25: the hosting device's half of the creation record. The opener rides on the open_session context; the
// new session copies it into a durable entry on its first start and records it in its own device's store, so a thread
// knows its opener on the device that hosts it, also after a restart re-opens it without the context.

const directories: string[] = []
const stores: GatewayStore[] = []
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function hostingDevice() {
  const directory = mkdtempSync(join(tmpdir(), "opened-by-"))
  directories.push(directory)
  const store = createGatewayStore({ agentDir: directory })
  stores.push(store)
  return store
}

function sessionSide(store: GatewayStore, context: Record<string, string>, entries: unknown[] = []) {
  const handlers: ((payload: unknown, ctx?: unknown) => unknown)[] = []
  const pi = {
    sessionContext: context,
    on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown) {
      if (event === "session_start") handlers.push(handler)
    },
    appendEntry(customType: string, data?: unknown) {
      entries.push({ type: "custom", customType, data })
    },
  }
  registerOpenedBy(pi as never, { store: () => store, thisDevice: async () => "dev-b" })
  const ctx = { sessionManager: { getEntries: () => entries, getSessionId: () => "dur-child" } }
  return {
    entries,
    start: async () => {
      for (const handler of handlers) await handler({ type: "session_start" }, ctx)
    },
  }
}

const OPENER = { thread: "dur-lead", device: "dev-a" }

test("#given a session opened with metadata #when it starts and later restarts #then its device stores the value once and a later change stays", async () => {
  const store = hostingDevice()
  const context = { [OPENED_BY_CONTEXT_KEY]: JSON.stringify(OPENER), [METADATA_CONTEXT_KEY]: JSON.stringify({ role: "worker" }) }
  await sessionSide(store, context).start()
  expect(await store.threadMetadata("dur-child")).toMatchObject({ value: { role: "worker" }, updated_by: "dur-lead" })
  await store.setThreadMetadata({ durable_id: "dur-child", value: { role: "reviewer" } })
  await sessionSide(store, context).start()
  expect(await store.threadMetadata("dur-child")).toMatchObject({ value: { role: "reviewer" } })
})

test("#given a session opened by another thread #when it starts #then its device records the opener and the session keeps it in an entry", async () => {
  const store = hostingDevice()
  const side = sessionSide(store, { [OPENED_BY_CONTEXT_KEY]: JSON.stringify(OPENER) })
  await side.start()
  expect(await store.threadOpener("dur-child")).toMatchObject({ creator_durable_id: "dur-lead", creator_device: "dev-a" })
  expect(await store.threadChildren("dur-lead")).toEqual([
    expect.objectContaining({ created_durable_id: "dur-child", created_device: "dev-b" }),
  ])
  expect(side.entries).toEqual([{ type: "custom", customType: OPENED_BY_ENTRY, data: OPENER }])
})

test("#given a recorded opener #when a restart re-opens the session without the context #then the entry records it again as one row", async () => {
  const store = hostingDevice()
  const first = sessionSide(store, { [OPENED_BY_CONTEXT_KEY]: JSON.stringify(OPENER) })
  await first.start()
  const restarted = sessionSide(store, {}, first.entries)
  await restarted.start()
  expect((await store.threadChildren("dur-lead")).map((row) => row.created_durable_id)).toEqual(["dur-child"])
  expect(first.entries).toHaveLength(1)
})

test.each([
  ["no opener (a terminal session)", {}],
  ["a malformed opener", { [OPENED_BY_CONTEXT_KEY]: "{not json" }],
  ["itself as the opener", { [OPENED_BY_CONTEXT_KEY]: JSON.stringify({ thread: "dur-child", device: "dev-b" }) }],
])("#given %s #when the session starts #then nothing is recorded and no entry is written", async (_label, context) => {
  const store = hostingDevice()
  const side = sessionSide(store, context)
  await side.start()
  expect(await store.threadOpener("dur-child")).toBeUndefined()
  expect(side.entries).toEqual([])
})
