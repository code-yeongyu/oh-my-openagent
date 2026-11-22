import { afterEach, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { join } from "node:path"
import { ENGINE, createRemoteThreadFixture } from "./thread-remote-fixture"

const fixture = createRemoteThreadFixture()
afterEach(fixture.cleanup)
const thread = "disk-peer"
const limit = 1024 * 1024
const message = (content: string) => JSON.stringify({ type: "message", message: { role: "user", content } })

function diskReader(lines: readonly string[]) {
  const surface = fixture.surface(undefined, { diskSessions: [thread], sessions: [] })
  const path = join(surface.agentDir, `${thread}.jsonl`)
  fs.writeFileSync(path, lines.join("\n"))
  return { ...surface, path, read: (args: object = {}) => surface.run("thread_read", { thread, ...args }) }
}

test("thread_read recovery skips an oversized record and returns the surrounding messages within bounded pages", async () => {
  // Blank padding leaves no complete entry in the initial tail, even with a normal record after the oversized one.
  const { read, path } = diskReader([
    message("before"),
    message("x".repeat(2 * limit)),
    message("after"),
    " ".repeat(limit),
  ])
  const failed = await read()
  if (failed.kind !== "error") throw new Error("expected the empty tail window to fail")
  expect(failed.error.code).toBe("message_too_large")
  expect(failed.error.next_action).toBe(
    "In an eval cell, call tool.thread_read({ thread: thread, cursor: error.details.next_cursor }) with the same thread, then follow next_cursor until absent.",
  )
  const first = failed.error.details?.["next_cursor"]
  if (typeof first !== "string") throw new Error("expected recovery cursor")
  const contents: string[] = []
  const seen = new Set<string>()
  let cursor: string | undefined = first
  using reads = spyOn(fs, "readSync")
  while (cursor !== undefined) {
    expect(seen.has(cursor)).toBe(false)
    seen.add(cursor)
    expect(seen.size).toBeLessThan(10)
    reads.mockClear()
    const page = await read({ cursor, max_bytes: 512 })
    if (page.kind !== "ok" || !("items" in page)) throw new Error(JSON.stringify(page))
    const bytes = reads.mock.results.reduce(
      (sum, r) => sum + (r.type === "return" && typeof r.value === "number" ? r.value : 0),
      0,
    )
    expect(bytes).toBeGreaterThan(0)
    expect(bytes).toBeLessThanOrEqual(limit)
    expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(512)
    contents.push(...page.items.map((item) => item.content))
    cursor = page.next_cursor
  }
  expect(contents).toEqual(['"before"', '"after"'])
  fs.appendFileSync(path, "\n" + message("new"))
  expect(await read({ cursor: first })).toMatchObject({ kind: "error", error: { code: "cursor_stale" } })
})

test("a file recovery cursor never loads the whole live transcript when the thread resumes", async () => {
  const { read } = diskReader([message("small"), message("x".repeat(limit * 2))])
  const failed = await read()
  if (failed.kind !== "error") throw new Error("expected an oversized tail")
  const cursor = failed.error.details?.["next_cursor"]
  if (typeof cursor !== "string") throw new Error("expected a file recovery cursor")
  const live = fixture.surface(undefined, {
    sessions: [{ sessionId: "route-peer", durableSessionId: thread, status: "open", cwd: process.cwd() }],
    engine: {
      ...ENGINE,
      get messages(): typeof ENGINE.messages {
        throw new Error("whole live transcript requested")
      },
    },
  })
  expect(await live.run("thread_read", { thread, cursor })).toMatchObject({
    kind: "error",
    error: { code: "cursor_stale" },
  })
})

test("thread_read rejects malformed cursors before filesystem access or host discovery", async () => {
  const { read, listings, store } = diskReader([message("one"), message("two")])
  using open = spyOn(fs, "openSync")
  using stat = spyOn(fs, "statSync")
  using reads = spyOn(fs, "readSync")
  using receipt = spyOn(store, "toolReceiptBegin")
  for (const cursor of [
    "!",
    Buffer.from("t1:1.abc:0").toString("base64url") + "!",
    Buffer.from("t2").toString("base64url"),
  ]) {
    expect(await read({ cursor })).toMatchObject({ kind: "error", error: { code: "cursor_invalid" } })
    expect(receipt).not.toHaveBeenCalled()
    expect(listings()).toBe(0)
    expect(stat).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(reads).not.toHaveBeenCalled()
  }
})

test("thread_read retains its 60-entry tail, 128 KiB default and 1 MiB maximum", async () => {
  const { read } = diskReader(Array.from({ length: 70 }, (_, i) => message(`${i}`)))
  const tail = await read()
  if (tail.kind !== "ok" || !("items" in tail)) throw new Error(JSON.stringify(tail))
  expect(tail.items.map((item) => item.content)).toEqual(
    Array.from({ length: 60 }, (_, i) => JSON.stringify(`${i + 10}`)),
  )
  const bigger = diskReader(Array.from({ length: 5 }, () => message("x".repeat(40_000))))
  const normal = await bigger.read()
  if (normal.kind !== "ok" || !("items" in normal)) throw new Error(JSON.stringify(normal))
  expect(normal.items).toHaveLength(3)
  expect(await bigger.read({ max_bytes: limit })).toMatchObject({ kind: "ok", truncated: false })
  expect(await bigger.read({ max_bytes: limit + 1 })).toMatchObject({
    kind: "error",
    error: { code: "invalid_arguments" },
  })
})
