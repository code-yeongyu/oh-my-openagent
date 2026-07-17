import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Message } from "@oh-my-opencode/team-core/types"

import { buildPeerMessageEnvelope } from "./message"
import { createSessionMarkerIndex } from "./session-marker-index"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempSessionFile(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-marker-index-"))
  roots.push(root)
  return join(root, "session.jsonl")
}

function envelopeLine(messageId: string): string {
  const value: Message = { version: 1, messageId, from: "alpha", to: "lead", kind: "message", body: "ready", timestamp: 1 }
  const entry = { type: "message", message: { role: "user", content: buildPeerMessageEnvelope(value) } }
  return `${JSON.stringify(entry)}\n`
}

// Counting reader: records how many bytes each slice read consumes so tests can prove the index
// reads incrementally (only appended bytes) instead of re-reading the whole session file.
function countingReader(counter: { bytes: number }) {
  return async (path: string, start: number, end: number): Promise<string> => {
    counter.bytes += end - start
    const text = await readFile(path, "utf8")
    return text.slice(start, end)
  }
}

describe("createSessionMarkerIndex", () => {
  test("#given a session file with an envelope #when contains is queried #then it finds the messageId", async () => {
    // given
    const file = tempSessionFile()
    writeFileSync(file, envelopeLine("id-1"), "utf8")
    const index = createSessionMarkerIndex()

    // when / then
    expect(await index.contains(file, "id-1")).toBe(true)
    expect(await index.contains(file, "id-missing")).toBe(false)
  })

  test("#given repeated queries on an unchanged file #when contains runs again #then no bytes are re-read", async () => {
    // given
    const file = tempSessionFile()
    writeFileSync(file, envelopeLine("id-1"), "utf8")
    const counter = { bytes: 0 }
    const index = createSessionMarkerIndex(countingReader(counter))

    // when
    await index.contains(file, "id-1")
    const afterFirst = counter.bytes
    await index.contains(file, "id-1")
    await index.contains(file, "id-1")

    // then the file was read once; subsequent idle queries read nothing
    expect(afterFirst).toBeGreaterThan(0)
    expect(counter.bytes).toBe(afterFirst)
  })

  test("#given an appended envelope #when contains runs #then only the appended bytes are read", async () => {
    // given
    const file = tempSessionFile()
    writeFileSync(file, envelopeLine("id-1"), "utf8")
    const counter = { bytes: 0 }
    const index = createSessionMarkerIndex(countingReader(counter))
    await index.contains(file, "id-1")
    const afterFirst = counter.bytes

    // when a second envelope is appended
    const second = envelopeLine("id-2")
    appendFileSync(file, second, "utf8")
    const found = await index.contains(file, "id-2")

    // then only the appended slice was read (not the whole file again)
    expect(found).toBe(true)
    expect(counter.bytes - afterFirst).toBe(Buffer.byteLength(second, "utf8"))
    expect(await index.contains(file, "id-1")).toBe(true)
  })

  test("#given a missing session file #when contains runs #then it returns false", async () => {
    // given
    const index = createSessionMarkerIndex()

    // when / then
    expect(await index.contains(join(tmpdir(), "does-not-exist-senpi.jsonl"), "id-1")).toBe(false)
    expect(await index.contains(undefined, "id-1")).toBe(false)
  })

  test("#given a truncated/rotated file #when contains runs #then the index resets and rescans", async () => {
    // given an append-only file with two envelopes
    const file = tempSessionFile()
    writeFileSync(file, envelopeLine("id-old-1") + envelopeLine("id-old-2"), "utf8")
    const index = createSessionMarkerIndex()
    expect(await index.contains(file, "id-old-2")).toBe(true)

    // when the file is truncated to a smaller size (rotation/reset)
    writeFileSync(file, envelopeLine("id-new"), "utf8")

    // then the shrink is detected, the index resets, and the new content is visible
    expect(await index.contains(file, "id-new")).toBe(true)
  })
})
