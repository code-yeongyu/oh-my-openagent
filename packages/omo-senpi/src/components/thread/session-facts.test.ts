import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, readSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleAddressBook, type DiskSession } from "./address-book"
import { readSessionFacts, SESSION_FACTS_LAST_LINE_MAX_BYTES, SESSION_FACTS_WINDOW_BYTES } from "./session-facts"
import { summary } from "./tools/internals"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function sessionPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-session-facts-"))
  directories.push(directory)
  return join(directory, "session.jsonl")
}

function line(entry: Record<string, unknown>): string {
  return JSON.stringify(entry)
}

const HEADER = { type: "session", version: 3, id: "session-id", cwd: "/work", timestamp: "2026-09-30T01:00:00.000Z" }
const OLD = { type: "message", id: "old", parentId: null, timestamp: "2026-09-30T01:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "old" }] } }
const NEW_TIMESTAMP = "2026-09-30T02:00:00.000Z"

describe("readSessionFacts name from the tail window", () => {
  /** A long session whose only rename sits in the tail window, starting `offset` bytes after the window's first byte. */
  function renamedSession(offset: number): string {
    const path = sessionPath()
    const filler = { type: "message", id: "filler", parentId: null, timestamp: "2026-09-30T01:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "f".repeat(100 * 1024) }] } }
    const rename = `${line({ type: "session_info", name: "renamed", timestamp: "2026-09-30T01:30:00.000Z" })}\n`
    const trailer = (padding: number) => `${line({ type: "message", id: "tail", parentId: "filler", timestamp: NEW_TIMESTAMP, message: { role: "assistant", content: [{ type: "text", text: "t".repeat(padding) }] } })}\n`
    const padding = SESSION_FACTS_WINDOW_BYTES - offset - Buffer.byteLength(rename) - Buffer.byteLength(trailer(0))
    writeFileSync(path, `${line(HEADER)}\n${line(filler)}\n${rename}${trailer(padding)}`)
    return path
  }

  test("#given a rename line that starts exactly where the tail window starts #when facts are read #then the name is the renamed one, as when the window starts a byte earlier", () => {
    expect([0, 1].map((offset) => readSessionFacts(renamedSession(offset))?.name)).toEqual(["renamed", "renamed"])
  })
})

describe("readSessionFacts newest timestamp", () => {
  test("#given a normal small session #when facts are read #then the final entry timestamp is returned", () => {
    const path = sessionPath()
    const newest = { type: "message", id: "new", parentId: "old", timestamp: NEW_TIMESTAMP, message: { role: "assistant", content: [{ type: "text", text: "done" }] } }
    writeFileSync(path, `${[HEADER, OLD, newest].map(line).join("\n")}\n`)

    expect(readSessionFacts(path)?.updated_at).toBe(NEW_TIMESTAMP)
  })

  test("#given the final entry is larger than one facts window #when facts are read #then its timestamp is returned instead of an older entry", () => {
    const path = sessionPath()
    const newest = { type: "message", id: "new", parentId: "old", timestamp: NEW_TIMESTAMP, message: { role: "assistant", content: [{ type: "text", text: "x".repeat(160 * 1024) }] } }
    writeFileSync(path, `${[HEADER, OLD, newest].map(line).join("\n")}\n`)

    expect(readSessionFacts(path)?.updated_at).toBe(NEW_TIMESTAMP)
  })

  test("#given the final line is truncated #when facts are read #then updated_at is null rather than an older entry timestamp", () => {
    const path = sessionPath()
    writeFileSync(path, `${[HEADER, OLD].map(line).join("\n")}\n{"type":"message","id":"new","parentId":"old","timestamp":"${NEW_TIMESTAMP}","message":{"role":"assistant","content":"partial`)

    expect(readSessionFacts(path)?.updated_at).toBeNull()
  })

  test.each([
    ["mismatched brackets", `{"type":"message","timestamp":"${NEW_TIMESTAMP}","message":[}`],
    ["a missing value", `{"message":,"timestamp":"${NEW_TIMESTAMP}"}`],
    ["an invalid literal", `{"message":undefined,"timestamp":"${NEW_TIMESTAMP}"}`],
    ["an invalid nested value", `{"message":{"bad":},"timestamp":"${NEW_TIMESTAMP}"}`],
    ["a trailing comma", `{"timestamp":"${NEW_TIMESTAMP}",}`],
    ["an invalid string escape", `{"message":"\\q","timestamp":"${NEW_TIMESTAMP}"}`],
  ])("#given the final line has %s #when facts are read #then updated_at is null", (_label, malformed) => {
    const path = sessionPath()
    writeFileSync(path, `${[HEADER, OLD].map(line).join("\n")}\n${malformed}\n`)

    expect(readSessionFacts(path)?.updated_at).toBeNull()
  })

  test("#given the final complete entry exceeds the hard scan cap #when facts are read #then activity is unknown and total reads stay bounded", () => {
    const path = sessionPath()
    const newest = { type: "message", id: "new", parentId: "old", timestamp: NEW_TIMESTAMP, message: { role: "assistant", content: [{ type: "text", text: "x".repeat(2 * 1024 * 1024) }] } }
    writeFileSync(path, `${[HEADER, OLD, newest].map(line).join("\n")}\n`)
    let requestedBytes = 0
    const countedRead = (fd: number, buffer: Buffer, offset: number, length: number, position: number): number => {
      requestedBytes += length
      return readSync(fd, buffer, offset, length, position)
    }

    const facts = Reflect.apply(readSessionFacts, undefined, [path, countedRead])

    expect(facts?.updated_at).toBeNull()
    expect(requestedBytes).toBeGreaterThan(0)
    // The head window, the tail window plus the byte before it, the final byte, and the last-line scan cap.
    expect(requestedBytes).toBeLessThanOrEqual(SESSION_FACTS_WINDOW_BYTES + (SESSION_FACTS_WINDOW_BYTES + 1) + 1 + SESSION_FACTS_LAST_LINE_MAX_BYTES)
  })

  test("#given a newer entry is appended during the bounded reads #when facts are returned #then updated_at is null instead of the older snapshot timestamp", () => {
    const path = sessionPath()
    writeFileSync(path, `${[HEADER, OLD].map(line).join("\n")}\n`)
    let appended = false
    const appendDuringRead = (fd: number, buffer: Buffer, offset: number, length: number, position: number): number => {
      const bytesRead = readSync(fd, buffer, offset, length, position)
      if (!appended) {
        appended = true
        appendFileSync(path, `${line({ type: "message", id: "new", parentId: "old", timestamp: NEW_TIMESTAMP, message: { role: "assistant", content: "new" } })}\n`)
      }
      return bytesRead
    }

    const facts = Reflect.apply(readSessionFacts, undefined, [path, appendDuringRead])

    expect(facts?.updated_at).toBeNull()
  })
})

test("#given one thread has unknown activity #when the address book is assembled #then known timestamps sort first and unknown activity sorts last", () => {
  const sessions: DiskSession[] = [
    { durable_id: "unknown", name: null, cwd: "/unknown", created_at: "2026-09-30T01:00:00.000Z", updated_at: null, session_path: "/sessions/unknown.jsonl", source_host: null },
    { durable_id: "known", name: null, cwd: "/known", created_at: "2026-09-30T01:00:00.000Z", updated_at: NEW_TIMESTAMP, session_path: "/sessions/known.jsonl", source_host: null },
  ]

  expect(assembleAddressBook([], sessions).map((entry) => [entry.durable_id, entry.updated_at])).toEqual([
    ["known", NEW_TIMESTAMP],
    ["unknown", null],
  ])
})

test("#given the bounded reader cannot prove the newest timestamp #when thread list summarizes the row #then updated_at stays null", () => {
  const [entry] = assembleAddressBook([], [
    { durable_id: "unknown", name: null, cwd: "/unknown", created_at: "2026-09-30T01:00:00.000Z", updated_at: null, session_path: "/sessions/unknown.jsonl", source_host: null },
  ])
  const session = { sessionId: "route-1", durableSessionId: "unknown", cwd: "/unknown", status: "open" as const }

  expect(summary(session, entry).updated_at).toBeNull()
})
