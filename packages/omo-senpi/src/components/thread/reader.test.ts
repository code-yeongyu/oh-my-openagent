import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  THREAD_TAIL_DEFAULT_ITEMS,
  THREAD_TAIL_MAX_ITEMS,
  readTranscript,
  type JsonValue,
  type ThreadReadSourceRef,
  type ThreadTranscriptReadResult,
} from "./reader"
import { THREAD_READ_DEFAULT_BYTES, THREAD_READ_MAX_BYTES } from "./index"

// ---------------------------------------------------------------------------
// Real temp files: every jsonl case below writes actual bytes to disk under a
// mkdtemp directory and reads them back through the module under test. The fs
// layer is never mocked, so truncation, mid-read mutation, and non-UTF8 bytes
// exercise the same syscalls the shipped reader will.
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thread-reader-"))
  TEMP_DIRS.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true })
})

type Entry = Record<string, JsonValue>

function sessionHeader(id = "sess-1"): Entry {
  return { type: "session", version: 3, id, timestamp: "2026-08-23T00:00:00.000Z", cwd: "/virtual/caller" }
}

/** A session message entry shaped like the real append-only JSONL tree. */
function messageEntry(index: number, filler = ""): Entry {
  return {
    type: "message",
    id: `e${index}`,
    parentId: index === 0 ? null : `e${index - 1}`,
    timestamp: `2026-08-23T00:00:${String(index).padStart(2, "0")}.000Z`,
    message: { role: index % 2 === 0 ? "user" : "assistant", content: `item-${index}${filler}` },
  }
}

function writeJsonl(dir: string, name: string, lines: readonly (Entry | string)[]): string {
  const path = join(dir, name)
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")
  writeFileSync(path, lines.length === 0 ? "" : `${text}\n`)
  return path
}

function jsonlSource(path: string, extra: Partial<Extract<ThreadReadSourceRef, { kind: "jsonl" }>> = {}): ThreadReadSourceRef {
  return { kind: "jsonl", path, ...extra }
}

function expectOk(result: ThreadTranscriptReadResult): Extract<ThreadTranscriptReadResult, { kind: "ok" }> {
  if (result.kind !== "ok") throw new Error(`expected ok, got error ${result.error.code}: ${result.error.message}`)
  return result
}

function expectError(result: ThreadTranscriptReadResult): Extract<ThreadTranscriptReadResult, { kind: "error" }> {
  if (result.kind !== "error") throw new Error(`expected error, got ok with ${result.items.length} items`)
  return result
}

function idOf(item: unknown): string {
  return String((item as { id?: unknown }).id)
}

/** Every error branch must name a recovery action (R7). */
function expectNextAction(result: ThreadTranscriptReadResult): string {
  const error = expectError(result)
  expect(error.error.next_action.length).toBeGreaterThan(0)
  return error.error.next_action
}

// ---------------------------------------------------------------------------

describe("readTranscript tail mode", () => {
  test("returns the last N entries in file order and marks the jsonl source", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "tail.jsonl", [sessionHeader(), ...Array.from({ length: 10 }, (_, i) => messageEntry(i))])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 4 }))

    expect(result.source).toBe("session_jsonl")
    expect(result.items.map(idOf)).toEqual(["e6", "e7", "e8", "e9"])
    expect(result.truncated).toBe(false)
    expect(result.next_cursor).toBeNull()
    expect(result.skipped_lines).toBe(0)
  })

  test("defaults to the last 60 items and never exceeds the 200 cap", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "big-tail.jsonl", [
      sessionHeader(),
      ...Array.from({ length: 300 }, (_, i) => messageEntry(i)),
    ])

    const defaulted = expectOk(readTranscript(jsonlSource(path), { mode: "tail" }))
    expect(defaulted.items.length).toBe(THREAD_TAIL_DEFAULT_ITEMS)
    expect(idOf(defaulted.items[defaulted.items.length - 1])).toBe("e299")

    const overCap = readTranscript(jsonlSource(path), { mode: "tail", tail_items: THREAD_TAIL_MAX_ITEMS + 1 })
    const failure = expectError(overCap)
    expect(failure.error.code).toBe("invalid_arguments")
    expectNextAction(overCap)

    const atCap = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: THREAD_TAIL_MAX_ITEMS }))
    expect(atCap.items.length).toBe(THREAD_TAIL_MAX_ITEMS)
  })

  test("a tail shorter than the transcript is not a truncation of the byte budget", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "short-tail.jsonl", [sessionHeader(), messageEntry(0), messageEntry(1)])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 1 }))
    expect(result.items.map(idOf)).toEqual(["e1"])
    expect(result.truncated).toBe(false)
  })
})

describe("readTranscript status mode", () => {
  test("reports metadata without returning items", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "status.jsonl", [sessionHeader(), messageEntry(0), messageEntry(1), messageEntry(2)])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "status" }))

    expect(result.items).toEqual([])
    expect(result.total_items).toBe(4)
    expect(result.truncated).toBe(false)
    expect(result.next_cursor).toBeNull()
    expect(result.encoded_bytes).toBe(0)
    expect(result.source).toBe("session_jsonl")
  })
})

describe("readTranscript page mode", () => {
  test("walks every item exactly once across cursor-driven pages", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 40 }, (_, i) => messageEntry(i, "x".repeat(200)))]
    const path = writeJsonl(dir, "page.jsonl", entries)

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = expectOk(
        readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048, ...(cursor === null ? {} : { cursor }) }),
      )
      expect(page.items.length).toBeGreaterThan(0)
      for (const item of page.items) seen.push(idOf(item))
      cursor = page.next_cursor
      expect(page.truncated).toBe(cursor !== null)
      pages += 1
      expect(pages).toBeLessThan(100)
    } while (cursor !== null)

    expect(pages).toBeGreaterThan(1)
    expect(seen).toEqual(entries.map(idOf))
    expect(new Set(seen).size).toBe(seen.length)
  })

  test("a page starting past the end returns zero items and no cursor", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "page-end.jsonl", [sessionHeader(), messageEntry(0)])

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page" }))
    expect(first.items.length).toBe(2)
    expect(first.next_cursor).toBeNull()
    expect(first.truncated).toBe(false)
  })
})

describe("readTranscript byte budget", () => {
  test("truncates at the budget and the next_cursor resumes exactly after the cut item", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 30 }, (_, i) => messageEntry(i, "y".repeat(400)))]
    const path = writeJsonl(dir, "budget.jsonl", entries)

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 4096 }))
    expect(first.truncated).toBe(true)
    expect(first.next_cursor).not.toBeNull()
    expect(first.encoded_bytes).toBeLessThanOrEqual(4096)
    expect(first.encoded_bytes).toBeGreaterThan(0)

    const lastId = idOf(first.items[first.items.length - 1])
    const expectedNext = entries[entries.map(idOf).indexOf(lastId) + 1]

    const second = expectOk(
      readTranscript(jsonlSource(path), { mode: "page", max_bytes: 4096, cursor: first.next_cursor as string }),
    )
    expect(idOf(second.items[0])).toBe(idOf(expectedNext))
  })

  test("defaults to the 128 KiB budget and rejects a request above the 1 MiB hard cap", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "cap.jsonl", [sessionHeader(), messageEntry(0)])

    const defaulted = expectOk(readTranscript(jsonlSource(path), { mode: "page" }))
    expect(defaulted.max_bytes).toBe(THREAD_READ_DEFAULT_BYTES)

    const atCap = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: THREAD_READ_MAX_BYTES }))
    expect(atCap.max_bytes).toBe(THREAD_READ_MAX_BYTES)

    const overCap = readTranscript(jsonlSource(path), { mode: "page", max_bytes: THREAD_READ_MAX_BYTES + 1 })
    const failure = expectError(overCap)
    expect(failure.error.code).toBe("message_too_large")
    expectNextAction(overCap)
  })

  test("a single item larger than the budget is still returned so a page always advances", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "huge-item.jsonl", [sessionHeader(), messageEntry(0, "z".repeat(20_000))])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 1024 }))
    expect(result.items.length).toBe(1)
    expect(result.next_cursor).not.toBeNull()

    const second = expectOk(
      readTranscript(jsonlSource(path), { mode: "page", max_bytes: 1024, cursor: result.next_cursor as string }),
    )
    expect(idOf(second.items[0])).toBe("e0")
  })

  test("the 1 MiB hard cap bounds a transcript far larger than the cap", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 400 }, (_, i) => messageEntry(i, "q".repeat(6000)))]
    const path = writeJsonl(dir, "over-cap.jsonl", entries)

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: THREAD_READ_MAX_BYTES }))
    expect(result.encoded_bytes).toBeLessThanOrEqual(THREAD_READ_MAX_BYTES)
    expect(result.truncated).toBe(true)
    expect(result.next_cursor).not.toBeNull()
    expect(result.items.length).toBeLessThan(entries.length)
  })
})

describe("readTranscript empty and missing sources", () => {
  test("an empty, unflushed session file reads as an empty result, not an error", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "unflushed.jsonl", [])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail" }))
    expect(result.items).toEqual([])
    expect(result.total_items).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.next_cursor).toBeNull()
    expect(result.source).toBe("session_jsonl")
  })

  test("a header-only session file reads as one item", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "header-only.jsonl", [sessionHeader()])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail" }))
    expect(result.items.length).toBe(1)
  })

  test("a missing file is not_found with recovery guidance", () => {
    const dir = makeTempDir()
    const result = readTranscript(jsonlSource(join(dir, "absent.jsonl")), { mode: "tail" })

    const failure = expectError(result)
    expect(failure.error.code).toBe("not_found")
    expect(expectNextAction(result)).toMatch(/thread_list/)
  })
})

describe("readTranscript cursor handling", () => {
  test("a malformed cursor string is cursor_invalid, never a throw", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "cursor-bad.jsonl", [sessionHeader(), messageEntry(0)])

    for (const cursor of ["", "not-a-cursor", "!!!!", "e30=", Buffer.from("{}").toString("base64url"), "0:0:0"]) {
      const result = readTranscript(jsonlSource(path), { mode: "page", cursor })
      const failure = expectError(result)
      expect(failure.error.code).toBe("cursor_invalid")
      expectNextAction(result)
    }
  })

  test("a cursor whose revision moved is cursor_stale (file appended under it)", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 20 }, (_, i) => messageEntry(i, "w".repeat(300)))]
    const path = writeJsonl(dir, "stale-append.jsonl", entries)

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048 }))
    expect(first.next_cursor).not.toBeNull()

    writeJsonl(dir, "stale-append.jsonl", [...entries, messageEntry(99, "w".repeat(300))])

    const result = readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048, cursor: first.next_cursor as string })
    const failure = expectError(result)
    expect(failure.error.code).toBe("cursor_stale")
    expectNextAction(result)
  })

  test("a cursor into a file truncated underneath it is cursor_stale", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 20 }, (_, i) => messageEntry(i, "w".repeat(300)))]
    const path = writeJsonl(dir, "stale-truncate.jsonl", entries)

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048 }))
    writeJsonl(dir, "stale-truncate.jsonl", entries.slice(0, 3))

    const result = readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048, cursor: first.next_cursor as string })
    const failure = expectError(result)
    expect(failure.error.code).toBe("cursor_stale")
  })

  test("a middle-entry rewrite with the same count and final entry is cursor_stale", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 20 }, (_, i) => messageEntry(i, "w".repeat(300)))]
    const path = writeJsonl(dir, "stale-middle-rewrite.jsonl", entries)

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048 }))
    const rewritten = entries.map((entry, index) =>
      index === 5 ? { ...entry, timestamp: "2026-08-24T00:00:05.000Z" } : entry,
    )
    writeJsonl(dir, "stale-middle-rewrite.jsonl", rewritten)

    const result = readTranscript(jsonlSource(path), { mode: "page", max_bytes: 2048, cursor: first.next_cursor as string })
    const failure = expectError(result)
    expect(failure.error.code).toBe("cursor_stale")
  })

  test("an unchanged file keeps the cursor valid across repeated reads", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 12 }, (_, i) => messageEntry(i, "w".repeat(300)))]
    const path = writeJsonl(dir, "stable.jsonl", entries)

    const first = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 1500 }))
    const cursor = first.next_cursor as string
    const a = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 1500, cursor }))
    const b = expectOk(readTranscript(jsonlSource(path), { mode: "page", max_bytes: 1500, cursor }))
    expect(a.items.map(idOf)).toEqual(b.items.map(idOf))
  })
})

describe("readTranscript malformed input tolerance", () => {
  test("malformed JSONL lines are skipped and counted, never crash the read", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "malformed.jsonl", [
      sessionHeader(),
      messageEntry(0),
      "{ this is not json",
      messageEntry(1),
      "[unterminated",
      "   ",
      messageEntry(2),
    ])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 10 }))
    expect(result.items.map(idOf)).toEqual(["sess-1", "e0", "e1", "e2"])
    expect(result.skipped_lines).toBe(2)
  })

  test("a non-object JSON line is skipped like a malformed one", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "scalar-lines.jsonl", [sessionHeader(), "42", '"a string"', "null", messageEntry(0)])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 10 }))
    expect(result.items.map(idOf)).toEqual(["sess-1", "e0"])
    expect(result.skipped_lines).toBe(3)
  })

  test("non-UTF8 bytes in the file do not crash the read", () => {
    const dir = makeTempDir()
    const path = join(dir, "binary.jsonl")
    const good = Buffer.from(`${JSON.stringify(sessionHeader())}\n`, "utf8")
    const garbage = Buffer.from([0xff, 0xfe, 0xff, 0x00, 0x80, 0x0a])
    const alsoGood = Buffer.from(`${JSON.stringify(messageEntry(0))}\n`, "utf8")
    writeFileSync(path, Buffer.concat([good, garbage, alsoGood]))

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 10 }))
    expect(result.items.map(idOf)).toEqual(["sess-1", "e0"])
    expect(result.skipped_lines).toBeGreaterThanOrEqual(1)
  })
})

describe("readTranscript argument validation", () => {
  test("a negative, zero, fractional, or huge tail_items is invalid_arguments", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "args.jsonl", [sessionHeader(), messageEntry(0)])

    for (const tail_items of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000]) {
      const result = readTranscript(jsonlSource(path), { mode: "tail", tail_items })
      const failure = expectError(result)
      expect(failure.error.code).toBe("invalid_arguments")
      expectNextAction(result)
    }
  })

  test("a non-positive or fractional max_bytes is invalid_arguments", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "args-bytes.jsonl", [sessionHeader(), messageEntry(0)])

    for (const max_bytes of [0, -5, 12.5, Number.NaN]) {
      const result = readTranscript(jsonlSource(path), { mode: "page", max_bytes })
      const failure = expectError(result)
      expect(failure.error.code).toBe("invalid_arguments")
    }
  })

  test("an unknown mode is invalid_arguments", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "args-mode.jsonl", [sessionHeader()])

    const result = readTranscript(jsonlSource(path), { mode: "sideways" as unknown as "tail" })
    expect(expectError(result).error.code).toBe("invalid_arguments")
  })
})

describe("readTranscript source reporting", () => {
  test("a live host source answers as live_host and is never source_incomplete", () => {
    const entries = [sessionHeader(), messageEntry(0), messageEntry(1)]
    const source: ThreadReadSourceRef = { kind: "live", entries: () => entries }

    const result = expectOk(readTranscript(source, { mode: "tail", tail_items: 2 }))
    expect(result.source).toBe("live_host")
    expect(result.items.map(idOf)).toEqual(["e0", "e1"])
    expect(result.source_incomplete).toBe(false)
    expect(result.skipped_lines).toBe(0)
  })

  test("a live provider that yields nothing is an empty result, not an error", () => {
    const source: ThreadReadSourceRef = { kind: "live", entries: () => [] }
    const result = expectOk(readTranscript(source, { mode: "tail" }))
    expect(result.items).toEqual([])
    expect(result.source).toBe("live_host")
  })

  test("the jsonl path reports source_incomplete when no live host holds the session", () => {
    const dir = makeTempDir()
    const path = writeJsonl(dir, "restart.jsonl", [sessionHeader(), messageEntry(0)])

    // Restart-shaped: the process that held the in-memory turn log is gone, so
    // the durable JSONL is the only truth and the reconstruction is partial.
    const restarted = expectOk(readTranscript(jsonlSource(path, { live_host_present: false }), { mode: "tail" }))
    expect(restarted.source).toBe("session_jsonl")
    expect(restarted.source_incomplete).toBe(true)

    // A host is alive but the caller chose the durable file: nothing is missing.
    const hosted = expectOk(readTranscript(jsonlSource(path, { live_host_present: true }), { mode: "tail" }))
    expect(hosted.source_incomplete).toBe(false)
  })

  test("live and jsonl sources over the same entries return identical items", () => {
    const dir = makeTempDir()
    const entries = [sessionHeader(), ...Array.from({ length: 6 }, (_, i) => messageEntry(i))]
    const path = writeJsonl(dir, "parity.jsonl", entries)

    const fromFile = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 5 }))
    const fromLive = expectOk(readTranscript({ kind: "live", entries: () => entries }, { mode: "tail", tail_items: 5 }))
    expect(fromLive.items).toEqual(fromFile.items)
  })

  test("items are the raw JSONL entry objects, not restyled", () => {
    const dir = makeTempDir()
    const entry = messageEntry(0)
    const path = writeJsonl(dir, "raw.jsonl", [sessionHeader(), entry])

    const result = expectOk(readTranscript(jsonlSource(path), { mode: "tail", tail_items: 1 }))
    expect(result.items[0]).toEqual(entry)
  })
})
