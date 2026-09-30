import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleAddressBook, type DiskSession } from "./address-book"
import { readSessionFacts } from "./session-facts"

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
    expect(requestedBytes).toBeLessThanOrEqual(393_217)
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
