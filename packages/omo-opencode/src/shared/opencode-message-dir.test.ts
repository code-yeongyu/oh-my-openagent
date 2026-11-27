import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { getMessageDir } from "./opencode-message-dir"
import * as storageDetection from "./opencode-storage-detection"

const TEST_STORAGE = join(tmpdir(), `omo-msgdir-test-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE, "message")

function getFixtureMessageDir(sessionID: string): string | null {
  return getMessageDir(sessionID, TEST_MESSAGE_STORAGE)
}

describe("getMessageDir", () => {
  beforeEach(() => {
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_STORAGE, { recursive: true, force: true })
  })

  it("returns null when sessionID does not start with ses_", () => {
    //#given - sessionID without ses_ prefix
    //#when
    const result = getFixtureMessageDir("invalid")
    //#then
    expect(result).toBe(null)
  })

  it("returns null when MESSAGE_STORAGE does not exist", () => {
    //#given
    rmSync(TEST_MESSAGE_STORAGE, { recursive: true, force: true })
    //#when
    const result = getFixtureMessageDir("ses_123")
    //#then
    expect(result).toBe(null)
  })

  it("returns direct path when session exists directly", () => {
    //#given
    const sessionDir = join(TEST_MESSAGE_STORAGE, "ses_123")
    mkdirSync(sessionDir, { recursive: true })
    //#when
    const result = getFixtureMessageDir("ses_123")
    //#then
    expect(result).toBe(sessionDir)
  })

  it("returns subdirectory path when session exists in subdirectory", () => {
    //#given
    const sessionDir = join(TEST_MESSAGE_STORAGE, "subdir", "ses_123")
    mkdirSync(sessionDir, { recursive: true })
    //#when
    const result = getFixtureMessageDir("ses_123")
    //#then
    expect(result).toBe(sessionDir)
  })

  it("returns file fallback path even when SQLite backend is active", () => {
    //#given
    const sessionDir = join(TEST_MESSAGE_STORAGE, "subdir", "ses_123")
    mkdirSync(sessionDir, { recursive: true })

    const sqlite = spyOn(storageDetection, "isSqliteBackend").mockReturnValue(true)
    try {
      //#when
      const result = getFixtureMessageDir("ses_123")

      //#then
      expect(result).toBe(sessionDir)
    } finally {
      sqlite.mockRestore()
    }
  })

  it("returns null for path traversal attempts with ..", () => {
    //#given - sessionID containing path traversal
    //#when
    const result = getFixtureMessageDir("ses_../etc/passwd")
    //#then
    expect(result).toBe(null)
  })

  it("returns null for path traversal attempts with forward slash", () => {
    //#given - sessionID containing forward slash
    //#when
    const result = getFixtureMessageDir("ses_foo/bar")
    //#then
    expect(result).toBe(null)
  })

  it("returns null for path traversal attempts with backslash", () => {
    //#given - sessionID containing backslash
    //#when
    const result = getFixtureMessageDir("ses_foo\\bar")
    //#then
    expect(result).toBe(null)
  })

  it("returns null when session not found anywhere", () => {
    //#given
    mkdirSync(join(TEST_MESSAGE_STORAGE, "subdir1"), { recursive: true })
    mkdirSync(join(TEST_MESSAGE_STORAGE, "subdir2"), { recursive: true })
    //#when
    const result = getFixtureMessageDir("ses_nonexistent")
    //#then
    expect(result).toBe(null)
  })
})
