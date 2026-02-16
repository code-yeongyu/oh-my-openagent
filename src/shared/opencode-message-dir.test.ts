import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

const TEST_STORAGE = join(tmpdir(), `omo-msgdir-test-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE, "message")

mock.module("./opencode-storage-paths", () => ({
  OPENCODE_STORAGE: TEST_STORAGE,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: join(TEST_STORAGE, "part"),
  SESSION_STORAGE: join(TEST_STORAGE, "session"),
}))

mock.module("./opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const { getMessageDir } = await import("./opencode-message-dir")

describe("getMessageDir", () => {
  beforeEach(() => {
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TEST_MESSAGE_STORAGE, { recursive: true, force: true }) } catch {}
  })

  afterAll(() => {
    try { rmSync(TEST_STORAGE, { recursive: true, force: true }) } catch {}
  })

  it("returns null when sessionID does not start with ses_", () => {
    //#given - sessionID without ses_ prefix
    //#when
    const result = getMessageDir("invalid")
    //#then
    expect(result).toBe(null)
  })

  it("returns null when MESSAGE_STORAGE does not exist", () => {
    //#given
    rmSync(TEST_MESSAGE_STORAGE, { recursive: true, force: true })
    //#when
    const result = getMessageDir("ses_123")
    //#then
    expect(result).toBe(null)
  })

  it("returns direct path when session exists directly", () => {
    //#given
    const sessionDir = join(TEST_MESSAGE_STORAGE, "ses_123")
    mkdirSync(sessionDir, { recursive: true })
    //#when
    const result = getMessageDir("ses_123")
    //#then
    expect(result).toBe(sessionDir)
  })

  it("returns subdirectory path when session exists in subdirectory", () => {
    //#given
    const sessionDir = join(TEST_MESSAGE_STORAGE, "subdir", "ses_123")
    mkdirSync(sessionDir, { recursive: true })
    //#when
    const result = getMessageDir("ses_123")
    //#then
    expect(result).toBe(sessionDir)
  })

  it("returns null for path traversal attempts with ..", () => {
    //#given - sessionID containing path traversal
    //#when
    const result = getMessageDir("ses_../etc/passwd")
    //#then
    expect(result).toBe(null)
  })

  it("returns null for path traversal attempts with forward slash", () => {
    //#given - sessionID containing forward slash
    //#when
    const result = getMessageDir("ses_foo/bar")
    //#then
    expect(result).toBe(null)
  })

  it("returns null for path traversal attempts with backslash", () => {
    //#given - sessionID containing backslash
    //#when
    const result = getMessageDir("ses_foo\\bar")
    //#then
    expect(result).toBe(null)
  })

  it("returns null when session not found anywhere", () => {
    //#given
    mkdirSync(join(TEST_MESSAGE_STORAGE, "subdir1"), { recursive: true })
    mkdirSync(join(TEST_MESSAGE_STORAGE, "subdir2"), { recursive: true })
    //#when
    const result = getMessageDir("ses_nonexistent")
    //#then
    expect(result).toBe(null)
  })
})