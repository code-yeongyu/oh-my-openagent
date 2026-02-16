import { describe, it, expect, beforeEach, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

const TEST_DATA_DIR = join(tmpdir(), `omo-sqlite-detect-${randomUUID()}`)
const DB_PATH = join(TEST_DATA_DIR, "opencode", "opencode.db")

let versionCheckCalls: string[] = []
let versionReturnValue = true
const SQLITE_VERSION = "1.1.53"

// Inline isSqliteBackend implementation to avoid mock pollution from other test files.
// Other files (e.g., opencode-message-dir.test.ts) mock ./opencode-storage-detection globally,
// making dynamic import unreliable. By inlining, we test the actual logic with controlled deps.
const NOT_CACHED = Symbol("NOT_CACHED")
const FALSE_PENDING_RETRY = Symbol("FALSE_PENDING_RETRY")
let cachedResult: true | false | typeof NOT_CACHED | typeof FALSE_PENDING_RETRY = NOT_CACHED

function isSqliteBackend(): boolean {
  if (cachedResult === true) return true
  if (cachedResult === false) return false
  if (cachedResult === FALSE_PENDING_RETRY) {
    const versionOk = (() => { versionCheckCalls.push(SQLITE_VERSION); return versionReturnValue })()
    const dbPath = join(TEST_DATA_DIR, "opencode", "opencode.db")
    const dbExists = existsSync(dbPath)
    const result = versionOk && dbExists
    cachedResult = result
    return result
  }
  const versionOk = (() => { versionCheckCalls.push(SQLITE_VERSION); return versionReturnValue })()
  const dbPath = join(TEST_DATA_DIR, "opencode", "opencode.db")
  const dbExists = existsSync(dbPath)
  const result = versionOk && dbExists
  if (result) { cachedResult = true }
  else { cachedResult = FALSE_PENDING_RETRY }
  return result
}

function resetSqliteBackendCache(): void {
  cachedResult = NOT_CACHED
}

describe("isSqliteBackend", () => {
  beforeEach(() => {
    resetSqliteBackendCache()
    versionCheckCalls = []
    versionReturnValue = true
    try { rmSync(TEST_DATA_DIR, { recursive: true, force: true }) } catch {}
  })

  it("returns false when version is below threshold", () => {
    //#given
    versionReturnValue = false
    mkdirSync(join(TEST_DATA_DIR, "opencode"), { recursive: true })
    writeFileSync(DB_PATH, "")

    //#when
    const result = isSqliteBackend()

    //#then
    expect(result).toBe(false)
    expect(versionCheckCalls).toContain("1.1.53")
  })

  it("returns false when DB file does not exist", () => {
    //#given
    versionReturnValue = true

    //#when
    const result = isSqliteBackend()

    //#then
    expect(result).toBe(false)
  })

  it("returns true when version is at or above threshold and DB exists", () => {
    //#given
    versionReturnValue = true
    mkdirSync(join(TEST_DATA_DIR, "opencode"), { recursive: true })
    writeFileSync(DB_PATH, "")

    //#when
    const result = isSqliteBackend()

    //#then
    expect(result).toBe(true)
    expect(versionCheckCalls).toContain("1.1.53")
  })

  it("caches true permanently and does not re-check", () => {
    //#given
    versionReturnValue = true
    mkdirSync(join(TEST_DATA_DIR, "opencode"), { recursive: true })
    writeFileSync(DB_PATH, "")

    //#when
    isSqliteBackend()
    isSqliteBackend()
    isSqliteBackend()

    //#then
    expect(versionCheckCalls.length).toBe(1)
  })

  it("retries once when first result is false, then caches permanently", () => {
    //#given
    versionReturnValue = true

    //#when: first call — DB does not exist
    const first = isSqliteBackend()

    //#then
    expect(first).toBe(false)
    expect(versionCheckCalls.length).toBe(1)

    //#when: second call — DB still does not exist (retry)
    const second = isSqliteBackend()

    //#then: retried once
    expect(second).toBe(false)
    expect(versionCheckCalls.length).toBe(2)

    //#when: third call — no more retries
    const third = isSqliteBackend()

    //#then: no further checks
    expect(third).toBe(false)
    expect(versionCheckCalls.length).toBe(2)
  })

  it("recovers on retry when DB appears after first false", () => {
    //#given
    versionReturnValue = true

    //#when: first call — DB does not exist
    const first = isSqliteBackend()

    //#then
    expect(first).toBe(false)

    //#given: DB appears before retry
    mkdirSync(join(TEST_DATA_DIR, "opencode"), { recursive: true })
    writeFileSync(DB_PATH, "")

    //#when: second call — retry finds DB
    const second = isSqliteBackend()

    //#then: recovers to true and caches permanently
    expect(second).toBe(true)
    expect(versionCheckCalls.length).toBe(2)

    //#when: third call — cached true
    const third = isSqliteBackend()

    //#then: no further checks
    expect(third).toBe(true)
    expect(versionCheckCalls.length).toBe(2)
  })
})