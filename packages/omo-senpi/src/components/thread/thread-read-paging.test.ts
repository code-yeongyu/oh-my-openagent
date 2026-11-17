import { afterEach, describe, expect, test } from "bun:test"
import type { ThreadToolResult } from "./contracts"
import type { JsonObject, RemoteThreadSurface } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"
import { ENGINE, comparable, createRemoteThreadFixture } from "./thread-remote-fixture"
import { sessionEntries, type FakeEntryLog } from "./thread-remote-entries-fixture"
import type { ThreadHostSession } from "./tools"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)

// A long transcript: 400 messages of ~2 KiB, ~800 KiB as one get_messages answer.
const MESSAGES: readonly ThreadTranscriptEntry[] = Array.from({ length: 400 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  content: `message ${index} ${"x".repeat(2000)}`,
}))

const LOCAL: ThreadHostSession = {
  sessionId: "route-local",
  durableSessionId: "dur-local",
  cwd: process.cwd(),
  name: "local peer",
  status: "open",
}

/** b's account with a paging engine, every engine reply measured as it crosses the relay. */
function pagingAccount(messages: readonly ThreadTranscriptEntry[] = MESSAGES) {
  const log: FakeEntryLog = { entries: sessionEntries(messages), pages: 0 }
  const a = fixture.account({ engine: { ...ENGINE, messages }, entries: log })
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
  const { run } = fixture.surface(remote, { sessions: [LOCAL], engine: { ...ENGINE, messages } })
  const reads = () => replies.filter((reply) => reply.rpc["type"] === "get_entries" || reply.rpc["type"] === "get_messages")
  return { run, log, replies, reads }
}

const cursorOf = (result: ThreadToolResult) => (result as { next_cursor?: string }).next_cursor
const itemsOf = (result: ThreadToolResult) =>
  result.kind === "ok" && "items" in result ? result.items : []
const withoutCursor = (result: ThreadToolResult) => {
  const { next_cursor: _cursor, ...rest } = comparable(result) as Record<string, unknown>
  return rest
}

describe("#14047: thread_read of a thread on another device costs its slice, not its transcript", () => {
  test("#given a long transcript on b's paging engine #when thread_read takes 1500 bytes #then b sends a page of its newest entries, never get_messages, and the answer equals this device's read of the same transcript", async () => {
    const { run, reads } = pagingAccount()
    const here = await run("thread_read", { thread: "dur-local", max_bytes: 1500 })
    const there = await run("thread_read", { thread: "dur-on-b", max_bytes: 1500 })
    expect(there).toMatchObject({ kind: "ok", truncated: true, source: "live_host", device: "b" })
    expect(withoutCursor(there)).toEqual(withoutCursor(here))
    expect(reads().some((reply) => reply.rpc["type"] === "get_messages")).toBe(false)
    const paged = reads().reduce((total, reply) => total + reply.bytes, 0)
    const whole = JSON.stringify({ messages: MESSAGES }).length
    expect(paged).toBeLessThan(whole / 2)
  })

  test("#given a truncated read on both legs #when each follows its next_cursor to the end #then both walks return the same items", async () => {
    const { run } = pagingAccount()
    const walk = async (thread: string) => {
      const items: unknown[] = []
      let cursor: string | undefined
      for (let page = 0; page < 200; page += 1) {
        const result = await run("thread_read", { thread, max_bytes: 9000, ...(cursor === undefined ? {} : { cursor }) })
        if (result.kind !== "ok") throw new Error(JSON.stringify(result))
        items.push(...itemsOf(result))
        cursor = cursorOf(result)
        if (cursor === undefined) return items
      }
      throw new Error("the walk did not end")
    }
    const there = await walk("dur-on-b")
    expect(there.length).toBe(60)
    expect(there).toEqual(await walk("dur-local"))
  })

  test("#given a read b already answered #when the transcript has not changed and thread_read runs again #then b is asked only for entries after the newest one kept, answers none, and the result is the same", async () => {
    const { run, reads } = pagingAccount()
    const first = await run("thread_read", { thread: "dur-on-b", max_bytes: 1500 })
    const before = reads().length
    const again = await run("thread_read", { thread: "dur-on-b", max_bytes: 1500 })
    const repeat = reads().slice(before)
    expect(repeat.map((reply) => reply.rpc["since"])).toEqual(["e399"])
    expect(repeat[0]?.data["entries"]).toEqual([])
    expect(again).toEqual(first)
  })

  test("#given a cursor from a read #when b's session appends a message #then that cursor is cursor_stale, only the new entry crosses the relay, and a fresh read ends with it", async () => {
    const { run, log, reads } = pagingAccount()
    const first = await run("thread_read", { thread: "dur-on-b", max_bytes: 1500 })
    const cursor = cursorOf(first)
    expect(cursor).toBeDefined()
    log.entries.push({ type: "message", id: "e400", message: { role: "assistant", content: "the newest answer" } })
    const before = reads().length
    expect(await run("thread_read", { thread: "dur-on-b", cursor, max_bytes: 1500 })).toMatchObject({
      kind: "error",
      error: { code: "cursor_stale" },
    })
    const refreshed = reads().slice(before)
    expect(refreshed.map((reply) => reply.rpc["since"])).toEqual(["e399"])
    expect((refreshed[0]?.data["entries"] as unknown[]).length).toBe(1)
    const fresh = await run("thread_read", { thread: "dur-on-b" })
    const items = itemsOf(fresh)
    expect(items.at(-1)?.content).toBe(JSON.stringify("the newest answer"))
    expect(items.length).toBe(60)
  })

  test("#given b's session file was rewritten so the kept newest entry is gone #when thread_read runs #then the window is read again from b's end", async () => {
    const { run, log } = pagingAccount()
    await run("thread_read", { thread: "dur-on-b", max_bytes: 1500 })
    log.entries.splice(0, log.entries.length, ...sessionEntries(MESSAGES.slice(0, 10)).map((entry) => ({ ...entry, id: `r-${String(entry["id"])}` })))
    const result = await run("thread_read", { thread: "dur-on-b" })
    expect(result).toMatchObject({ kind: "ok", truncated: false })
    expect(itemsOf(result).length).toBe(10)
  })

  test("#given an engine on b that pages nothing #when thread_read runs twice #then it reads the whole transcript as before and asks for a page only once", async () => {
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
    const { run, log } = pagingAccount(MESSAGES.slice(0, 30))
    const cursor = cursorOf(await run("thread_read", { thread: "dur-on-b", max_bytes: 800 }))
    expect(cursor).toBeDefined()
    log.refuse = "invalid_argument"
    expect(await run("thread_read", { thread: "dur-on-b", cursor, max_bytes: 800 })).toMatchObject({
      kind: "error",
      error: { code: "cursor_stale" },
    })
  })
})
