import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MAX_TRANSCRIPT_SOURCE_BYTES, readBoundedFileText } from "./read-bounded"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("readBoundedFileText", () => {
  test("#given a transcript larger than the source budget #when read #then memory is capped while head and tail survive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "senpi-task-transcript-"))
    tempDirs.push(dir)
    const path = join(dir, "large.jsonl")
    await writeFile(path, `${"a".repeat(MAX_TRANSCRIPT_SOURCE_BYTES)}MIDDLE${"z".repeat(MAX_TRANSCRIPT_SOURCE_BYTES)}`)

    const result = readBoundedFileText(path)

    expect(result?.truncated).toBe(true)
    expect(Buffer.byteLength(result?.text ?? "")).toBeLessThanOrEqual(MAX_TRANSCRIPT_SOURCE_BYTES + 1)
    expect(result?.text.startsWith("a")).toBe(true)
    expect(result?.text.endsWith("z")).toBe(true)
    expect(result?.text).not.toContain("MIDDLE")
  })
})
