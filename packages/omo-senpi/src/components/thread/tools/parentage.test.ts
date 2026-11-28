import { afterEach, expect, test } from "bun:test"

import type { ThreadToolResult } from "../contracts"
import { createGatewayHarness, type GatewayHarness } from "../gateway/testing/harness"
import { withParentage, withReadParentage } from "./parentage"

// #15221 row 25 (slice A): every listed row this device's store knows the opener of names it as `created_by`, a row it
// knows none for names no opener, and `children_of` keeps only the rows that thread opened. The store holds both ends of
// each creation, so this device answers for a child it opened elsewhere and for a child hosted here alike.

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

const row = (thread: string, device?: string) =>
  ({ thread, name: thread, status: "live", state: "idle", cwd: "/w", created_at: "t", updated_at: "t", link: "l", ...(device === undefined ? {} : { device }) }) as const

const listing = (...threads: ReturnType<typeof row>[]): ThreadToolResult =>
  ({ kind: "ok", threads, scope: "workspace" }) as unknown as ThreadToolResult

const threadsOf = (result: ThreadToolResult) => (result as unknown as { threads: Record<string, unknown>[] }).threads

async function store() {
  const h = (harness = createGatewayHarness())
  const s = h.store()
  await s.recordThreadCreation({ creator_durable_id: "lead", created_durable_id: "child-here", creator_device: "dev-a" })
  await s.recordThreadCreation({
    creator_durable_id: "lead",
    created_durable_id: "child-there",
    creator_device: "dev-a",
    created_device: "dev-b",
  })
  return s
}

test("#given rows with and without a recorded opener #when the listing is annotated #then each known one names its opener and device, the rest name none", async () => {
  const s = await store()
  const result = await withParentage(s, listing(row("lead"), row("child-here"), row("child-there", "dev-b")), undefined)
  expect(threadsOf(result).map((thread) => [thread["thread"], thread["created_by"]])).toEqual([
    ["lead", undefined],
    ["child-here", { thread: "lead", device: "dev-a" }],
    ["child-there", { thread: "lead", device: "dev-a" }],
  ])
})

test("#given children_of #when the listing is filtered #then only the threads that one opened remain, here and on another device", async () => {
  const s = await store()
  const result = await withParentage(s, listing(row("lead"), row("child-here"), row("child-there", "dev-b"), row("other")), "lead")
  expect(threadsOf(result).map((thread) => thread["thread"])).toEqual(["child-here", "child-there"])
})

test("#given a read of a child with metadata #when annotated #then it names its opener and carries the metadata; a read of a thread with neither gets neither", async () => {
  const s = await store()
  await s.setThreadMetadata({ durable_id: "child-here", value: { role: "reviewer" }, updated_by: "lead" })
  const read = (thread: string) => ({ kind: "ok", thread, link: "l", items: [], truncated: false, source: "live_host" }) as unknown as ThreadToolResult
  expect(await withReadParentage(s, read("child-here"))).toMatchObject({
    created_by: { thread: "lead", device: "dev-a" },
    metadata: { role: "reviewer" },
  })
  const plain = (await withReadParentage(s, read("lead"))) as unknown as Record<string, unknown>
  expect(Object.hasOwn(plain, "created_by")).toBe(false)
  expect(Object.hasOwn(plain, "metadata")).toBe(false)
})

test("#given a store that cannot be read #when annotated without a filter #then the listing stands and says why parentage is missing", async () => {
  const broken = {
    threadOpeners: async () => {
      throw new Error("store gone")
    },
  }
  const result = await withParentage(broken, listing(row("lead")), undefined)
  expect(threadsOf(result).map((thread) => thread["thread"])).toEqual(["lead"])
  expect(result).toMatchObject({ parentage_error: "store gone" })
})
