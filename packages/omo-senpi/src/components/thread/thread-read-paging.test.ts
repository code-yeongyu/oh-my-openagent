import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "./contracts"
import type { JsonObject, RemoteThreadSurface } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { ENGINE, comparable, createRemoteThreadFixture } from "./thread-remote-fixture"
import { senpiContext, sessionEntries, stamp, type FakeEntryLog } from "./thread-remote-entries-fixture"
import type { ThreadHostSession } from "./tools"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

const message = (index: number, text: string, size = 2000): ThreadTranscriptEntry => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `${text} ${"x".repeat(size)}`,
  timestamp: Date.UTC(2026, 10, 17) + index * 1000,
})
// A long transcript: 2000 messages of ~2 KiB, ~4 MiB as one get_messages answer (several 512 KiB pages).
const MESSAGES = Array.from({ length: 2000 }, (_, index) => message(index, `message ${index}`))

const LOCAL: ThreadHostSession = {
  sessionId: "route-local",
  durableSessionId: "dur-local",
  cwd: process.cwd(),
  name: "local peer",
  status: "open",
}

const entry = (type: string, id: string, parentId: string | null, fields: JsonObject = {}): ThreadTranscriptEntry => ({
  type,
  id,
  parentId,
  timestamp: stamp(Number(id.replace(/\D/g, "")) || 0),
  ...fields,
})

/** A chain of message entries under `parent`, ids `<prefix><n>`. */
function chain(prefix: string, parent: string | null, count: number, text: string): ThreadTranscriptEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry("message", `${prefix}${index}`, index === 0 ? parent : `${prefix}${index - 1}`, {
      message: message(index, `${text} ${index}`, 200),
    }),
  )
}

/**
 * b's account with a paging engine over `entries` at `leaf`, every engine reply measured as it crosses the relay.
 * `localAt` reads this device's thread holding the same entries at a leaf: senpi's own session.messages.
 */
function pagingAccount(entries: ThreadTranscriptEntry[], leaf?: string) {
  const log: FakeEntryLog = { entries, pages: 0, ...(leaf === undefined ? {} : { leaf }) }
  const at = leaf ?? (typeof entries.at(-1)?.["id"] === "string" ? String(entries.at(-1)?.["id"]) : null)
  const a = fixture.account({ engine: { ...ENGINE, messages: senpiContext(entries, at) }, entries: log })
  const replies: Array<{ readonly rpc: JsonObject; readonly bytes: number; readonly data: JsonObject }> = []
  const sessions = a.remote.sessions
  const remote: RemoteThreadSurface = {
    ...a.remote,
    sessions: {
      ...sessions,
      sessionCommand: async (device, session, rpc, options) => {
        const outcome = await sessions.sessionCommand(device, session, rpc, options)
        const data = outcome.kind === "ok" ? ((outcome.response["data"] ?? {}) as JsonObject) : {}
        replies.push({ rpc, bytes: JSON.stringify(outcome).length, data })
        return outcome
      },
    },
  }
  const run = (args: JsonObject) => fixture.surface(remote, {}).run("thread_read", { thread: "dur-on-b", ...args })
  const localAt = (at: string | null, args: JsonObject) =>
    fixture
      .surface(remote, { sessions: [LOCAL], engine: { ...ENGINE, messages: senpiContext(log.entries, at) } })
      .run("thread_read", { thread: "dur-local", ...args })
  const reads = () =>
    replies.filter((reply) => reply.rpc["type"] === "get_entries" || reply.rpc["type"] === "get_messages")
  return { run, localAt, log, reads }
}

const cursorOf = (result: ThreadToolResult) => (result as { next_cursor?: string }).next_cursor
const itemsOf = (result: ThreadToolResult) => (result.kind === "ok" && "items" in result ? result.items : [])
const withoutCursor = (result: ThreadToolResult) => {
  const { next_cursor: _cursor, ...rest } = comparable(result) as Record<string, unknown>
  return rest
}

// A session that branched: e0..e99, then the user went back to e49, left a branch summary and continued (b0..b9).
const BRANCHED = [
  ...chain("e", null, 100, "first branch"),
  entry("branch_summary", "s1", "e49", { fromId: "e99", summary: "tried another approach" }),
  ...chain("b", "s1", 10, "second branch"),
]
// A session compacted after e299 (keeping e280 on), then continued with a custom message and p0..p19.
const COMPACTED = [
  ...chain("e", null, 300, "before compaction"),
  entry("compaction", "c1", "e299", { summary: "the story so far", firstKeptEntryId: "e280", tokensBefore: 9000 }),
  entry("custom_message", "u1", "c1", { customType: "note", content: "a custom message", display: true }),
  ...chain("p", "u1", 20, "after compaction"),
]

// A session compacted long ago (keeping from e10), with 200 messages since: those alone are the context's tail.
const COMPACTED_LONG_AGO = [
  ...chain("e", null, 400, "before compaction"),
  entry("compaction", "c1", "e399", { summary: "long ago", firstKeptEntryId: "e10", tokensBefore: 9000 }),
  ...chain("p", "c1", 200, "after compaction"),
]

describe("#14047: thread_read of a thread on another device costs its slice, not its transcript", () => {
  test("#given a long transcript on b's paging engine #when thread_read takes 1500 bytes #then b sends pages of its newest entries (under a quarter of the transcript), never get_messages, and the answer equals this device's read of the same transcript", async () => {
    const { run, localAt, reads, log } = pagingAccount(sessionEntries(MESSAGES))
    const there = await run({ max_bytes: 1500 })
    expect(there).toMatchObject({ kind: "ok", truncated: true, source: "live_host", device: "b" })
    expect(withoutCursor(there)).toEqual(
      withoutCursor(await localAt(String(log.entries.at(-1)?.["id"]), { max_bytes: 1500 })),
    )
    expect(reads().some((reply) => reply.rpc["type"] === "get_messages")).toBe(false)
    const paged = reads().reduce((total, reply) => total + reply.bytes, 0)
    expect(paged).toBeLessThan(JSON.stringify({ messages: MESSAGES }).length / 4)
  })

  test.each([
    ["a session that branched (abandoned messages, a branch summary)", BRANCHED, "b9"],
    ["a session that compacted (its summary, kept messages and a custom message after it)", COMPACTED, "p19"],
  ] as const)(
    "#given %s on b #when thread_read walks every page #then it reads exactly what this device's engine reads for that session",
    async (_label, entries, leaf) => {
      const { run, localAt } = pagingAccount([...entries], leaf)
      const walk = async (read: (args: JsonObject) => Promise<ThreadToolResult>) => {
        const items: unknown[] = []
        for (let cursor: string | undefined, page = 0; page < 100; page += 1) {
          const result = await read({ max_bytes: 3000, ...(cursor === undefined ? {} : { cursor }) })
          if (result.kind !== "ok") throw new Error(JSON.stringify(result))
          items.push(...itemsOf(result))
          cursor = cursorOf(result)
          if (cursor === undefined) return items
        }
        throw new Error("the walk did not end")
      }
      const there = await walk(run)
      expect(there).toEqual(await walk((args) => localAt(leaf, args)))
      expect(there.length).toBe(Math.min(60, senpiContext([...entries], leaf).length))
    },
  )

  test("#given a session with more than a window of messages since its compaction #when thread_read runs cold #then one page of b's newest entries answers it (the compaction's kept entries are never fetched), as this device's engine reads it", async () => {
    const { run, localAt, reads } = pagingAccount([...COMPACTED_LONG_AGO], "p199")
    const there = await run({ max_bytes: 3000 })
    expect(reads().map((reply) => reply.rpc["type"])).toEqual(["get_entries"])
    expect(withoutCursor(there)).toEqual(withoutCursor(await localAt("p199", { max_bytes: 3000 })))
  })

  test("#given a read b already answered #when the transcript has not changed and thread_read runs again #then b is asked only for entries after the newest one kept, answers none, and the result is the same", async () => {
    const { run, reads } = pagingAccount(sessionEntries(MESSAGES))
    const first = await run({ max_bytes: 1500 })
    const before = reads().length
    const again = await run({ max_bytes: 1500 })
    const repeat = reads().slice(before)
    expect(repeat.map((reply) => reply.rpc["since"])).toEqual(["e1999"])
    expect(repeat[0]?.data["entries"]).toEqual([])
    expect(again).toEqual(first)
  })

  test("#given a cursor from a read #when b's session appends a message #then that cursor is cursor_stale, only the new entry crosses the relay, and a fresh read ends with it", async () => {
    const { run, log, reads } = pagingAccount(sessionEntries(MESSAGES))
    const cursor = cursorOf(await run({ max_bytes: 1500 }))
    expect(cursor).toBeDefined()
    log.entries.push(
      entry("message", "e2000", "e1999", { message: { role: "assistant", content: "the newest answer" } }),
    )
    const before = reads().length
    expect(await run({ cursor, max_bytes: 1500 })).toMatchObject({ kind: "error", error: { code: "cursor_stale" } })
    const refreshed = reads().slice(before)
    expect(refreshed.map((reply) => reply.rpc["since"])).toEqual(["e1999"])
    expect((refreshed[0]?.data["entries"] as unknown[]).length).toBe(1)
    const items = itemsOf(await run({}))
    expect(items.at(-1)?.content).toBe(JSON.stringify("the newest answer"))
    expect(items.length).toBe(60)
  })

  test("#given a read of b's branched session #when its user moves back to the first branch (a new leaf, no new entry) #then the next read shows that branch from the kept entries, as this device's engine would, and the earlier cursor is cursor_stale", async () => {
    const { run, localAt, log, reads } = pagingAccount([...BRANCHED], "b9")
    const cursor = cursorOf(await run({ max_bytes: 1500 }))
    expect(cursor).toBeDefined()
    log.leaf = "e99"
    const before = reads().length
    const moved = await run({ max_bytes: 1500 })
    expect(
      reads()
        .slice(before)
        .map((reply) => Object.keys(reply.rpc).filter((key) => key === "since" || key === "tail")),
    ).toEqual([["since"]])
    expect(withoutCursor(moved)).toEqual(withoutCursor(await localAt("e99", { max_bytes: 1500 })))
    expect(await run({ cursor, max_bytes: 1500 })).toMatchObject({ kind: "error", error: { code: "cursor_stale" } })
  })

  test("#given b's session file was rewritten so the kept newest entry is gone #when thread_read runs #then the tail is read again from b's end", async () => {
    const { run, log } = pagingAccount(sessionEntries(MESSAGES))
    await run({ max_bytes: 1500 })
    log.entries.splice(0, log.entries.length, ...chain("r", null, 10, "rewritten"))
    const result = await run({})
    expect(result).toMatchObject({ kind: "ok", truncated: false })
    expect(itemsOf(result).length).toBe(10)
  })

  test("#given a session whose newest messages alone pass the bytes this side keeps per session #when thread_read runs twice #then the second read pages b's end again instead of keeping them", async () => {
    const huge = Array.from({ length: 70 }, (_, index) => message(index, `big ${index}`, 70_000))
    const { run, reads } = pagingAccount(sessionEntries(huge))
    await run({ max_bytes: 1500 })
    const before = reads().length
    await run({ max_bytes: 1500 })
    expect(reads().slice(before)[0]?.rpc["tail"]).toBeDefined()
  })

  test.each(["invalid_argument", "response_too_large"])(
    "#given b's engine refuses a page with %s #when thread_read runs #then that read takes get_messages, and the next read pages again",
    async (reason) => {
      const { run, localAt, log, reads } = pagingAccount(sessionEntries(MESSAGES.slice(0, 30)))
      log.refuse = reason
      const refused = await run({ max_bytes: 800 })
      expect(comparable(refused)).toEqual(
        comparable(await localAt(String(log.entries.at(-1)?.["id"]), { max_bytes: 800 })),
      )
      delete log.refuse
      await run({ max_bytes: 800 })
      expect(reads().map((reply) => reply.rpc["type"])).toEqual(["get_entries", "get_messages", "get_entries"])
    },
  )

  test("#given a short transcript (a long preamble, then the reply) #when thread_read takes 1500 bytes on b and on this device #then both end at the reply, and next_cursor pages the older messages", async () => {
    const preamble = (index: number): ThreadTranscriptEntry => ({
      role: "user",
      content: `preamble ${index} ${"p".repeat(1200)}`,
      timestamp: Date.UTC(2026, 10, 17) + index * 1000,
    })
    const reply: ThreadTranscriptEntry = { role: "assistant", content: "READY", timestamp: Date.UTC(2026, 10, 18) }
    const { run, localAt, log } = pagingAccount(sessionEntries([preamble(0), preamble(1), reply]))
    const there = await run({ max_bytes: 1500 })
    const here = await localAt(String(log.entries.at(-1)?.["id"]), { max_bytes: 1500 })
    for (const result of [there, here]) {
      expect(result).toMatchObject({ kind: "ok", truncated: true })
      expect(itemsOf(result).at(-1)?.content).toBe(JSON.stringify("READY"))
    }
    expect(withoutCursor(there)).toEqual(withoutCursor(here))
    const older = await run({ cursor: cursorOf(there), max_bytes: 1500 })
    expect(itemsOf(older).map((item) => item.content)).toEqual([JSON.stringify(preamble(0).content)])
  })

  test("#given an engine on b without get_entries #when thread_read runs twice #then it reads the whole transcript as before and asks for a page only once", async () => {
    const a = fixture.account()
    const { run } = fixture.surface(a.remote, { sessions: [LOCAL] })
    const here = await run("thread_read", { thread: "dur-local", max_bytes: 800 })
    const first = await run("thread_read", { thread: "dur-on-b", max_bytes: 800 })
    await run("thread_read", { thread: "dur-on-b", max_bytes: 800 })
    expect(comparable(first)).toEqual(comparable(here))
    const types = a.sent.filter((sent) => sent.via === "session").map((sent) => sent.rpc?.["type"])
    expect(types.filter((type) => type === "get_entries")).toHaveLength(1)
    expect(types.filter((type) => type === "get_messages")).toHaveLength(2)
  })

  test("#given a cursor b's paged read issued #when b's engine stops paging #then the cursor is cursor_stale, never read against the whole transcript", async () => {
    const { run, log } = pagingAccount(sessionEntries(MESSAGES.slice(0, 30)))
    const cursor = cursorOf(await run({ max_bytes: 800 }))
    expect(cursor).toBeDefined()
    log.refuse = "unsupported"
    expect(await run({ cursor, max_bytes: 800 })).toMatchObject({ kind: "error", error: { code: "cursor_stale" } })
  })
})
