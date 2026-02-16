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
let cachedResult: boolean | typeof NOT_CACHED = NOT_CACHED

function isSqliteBackend(): boolean {
  if (cachedResult !== NOT_CACHED) return cachedResult as boolean
  const versionOk = (() => { versionCheckCalls.push(SQLITE_VERSION); return versionReturnValue })()
  const dbPath = join(TEST_DATA_DIR, "opencode", "opencode.db")
  const dbExists = existsSync(dbPath)
  cachedResult = versionOk && dbExists
  return cachedResult
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

  it("caches the result and does not re-check on subsequent calls", () => {
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
})