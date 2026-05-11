import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import {
  acquireFileLock,
  getSessionAliasStoragePath,
  mutateAliasFile,
  readAliasFile,
  writeAliasFileAtomic,
} from "./storage"

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "session-alias-storage-test-"))
}

describe("readAliasFile", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("returns empty when file missing", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    expect(readAliasFile(path)).toEqual({ version: 1, aliases: {} })
  })

  test("returns empty on invalid JSON", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "garbage{", "utf-8")
    expect(readAliasFile(path)).toEqual({ version: 1, aliases: {} })
  })

  test("returns empty on wrong version", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 5, aliases: {} }), "utf-8")
    expect(readAliasFile(path)).toEqual({ version: 1, aliases: {} })
  })

  test("filters out malformed entries", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        aliases: {
          good: { alias: "good", session_id: "ses_abc12345", created_at: 1 },
          bad1: { alias: "bad1" },
          bad2: null,
          bad3: "string",
        },
      }),
      "utf-8",
    )
    const file = readAliasFile(path)
    expect(Object.keys(file.aliases)).toEqual(["good"])
  })
})

describe("writeAliasFileAtomic", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("creates the file and parent directory", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    writeAliasFileAtomic(path, {
      version: 1,
      aliases: { foo: { alias: "foo", session_id: "ses_aaa11111", created_at: 1 } },
    })
    expect(existsSync(path)).toBe(true)
    const parsed = JSON.parse(readFileSync(path, "utf-8"))
    expect(parsed.aliases.foo.session_id).toBe("ses_aaa11111")
  })

  test("does not leave temp files behind on success", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    writeAliasFileAtomic(path, { version: 1, aliases: {} })
    const files = readdirSync(dirname(path))
    expect(files.filter((f) => f.includes(".tmp."))).toHaveLength(0)
  })

  test("overwrites existing file", () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    writeAliasFileAtomic(path, {
      version: 1,
      aliases: { a: { alias: "a", session_id: "ses_aaa11111", created_at: 1 } },
    })
    writeAliasFileAtomic(path, {
      version: 1,
      aliases: { b: { alias: "b", session_id: "ses_bbb22222", created_at: 2 } },
    })
    const file = readAliasFile(path)
    expect(Object.keys(file.aliases)).toEqual(["b"])
  })
})

describe("acquireFileLock", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("acquires and releases", () => {
    const path = join(dir, "target.json")
    const lock = acquireFileLock(path)
    expect(lock.acquired).toBe(true)
    lock.release()
    // Second acquisition succeeds after release
    const second = acquireFileLock(path)
    expect(second.acquired).toBe(true)
    second.release()
  })

  test("blocks concurrent acquisition", () => {
    const path = join(dir, "target.json")
    const first = acquireFileLock(path)
    expect(first.acquired).toBe(true)
    const second = acquireFileLock(path)
    expect(second.acquired).toBe(false)
    first.release()
  })

  test("steals stale lock", () => {
    const path = join(dir, "target.json")
    const lockPath = `${path}.lock`
    mkdirSync(dir, { recursive: true })
    // Write a stale lock (timestamp older than 30s)
    writeFileSync(
      lockPath,
      JSON.stringify({ id: "old", timestamp: Date.now() - 60_000, pid: 99999 }),
      "utf-8",
    )
    const lock = acquireFileLock(path)
    expect(lock.acquired).toBe(true)
    lock.release()
  })

  test("release is a no-op when not holding the lock", () => {
    const path = join(dir, "target.json")
    const first = acquireFileLock(path)
    const second = acquireFileLock(path)
    expect(second.acquired).toBe(false)
    // Should not throw
    second.release()
    first.release()
  })
})

describe("mutateAliasFile", () => {
  let dir: string
  beforeEach(() => {
    dir = makeTempDir()
  })

  test("applies mutator and writes result", async () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    const result = await mutateAliasFile(path, (current) => ({
      ...current,
      aliases: { ...current.aliases, foo: { alias: "foo", session_id: "ses_aaa11111", created_at: 1 } },
    }))
    expect(result.ok).toBe(true)
    expect(readAliasFile(path).aliases.foo).toBeTruthy()
  })

  test("null return aborts write", async () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    const result = await mutateAliasFile(path, () => null)
    expect(result.ok).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  test("releases lock even when mutator throws", async () => {
    const path = getSessionAliasStoragePath({ directory: dir })
    await expect(
      mutateAliasFile(path, () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    // Lock must be released; a follow-up call should succeed
    const result = await mutateAliasFile(path, (c) => c)
    expect(result.ok).toBe(true)
  })
})
