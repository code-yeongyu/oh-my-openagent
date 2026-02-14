declare const require: (name: string) => any
const { describe, it, expect, beforeEach, afterEach, beforeAll, mock } = require("bun:test")

let getMessageDir: (sessionID: string) => string | null

beforeAll(async () => {
  // Mock the data-path module
  mock.module("./data-path", () => ({
    getOpenCodeStorageDir: () => "/mock/opencode/storage",
  }))

  // Mock fs functions
  mock.module("node:fs", () => ({
    existsSync: mock(() => false),
    readdirSync: mock(() => []),
  }))

  mock.module("node:path", () => ({
    join: mock((...args: string[]) => args.join("/")),
  }))

  // Mock storage detection to return false (stable mode)
  mock.module("./opencode-storage-detection", () => ({
    isSqliteBackend: () => false,
    resetSqliteBackendCache: () => {},
  }))

  ;({ getMessageDir } = await import("./opencode-message-dir"))
})

describe("getMessageDir", () => {
  beforeEach(() => {
    // Reset mocks
    mock.restore()
  })

  it("returns null when sessionID does not start with ses_", () => {
    // given
    // no mocks needed

    // when
    const result = getMessageDir("invalid")

    // then
    expect(result).toBe(null)
  })

  it("returns null when MESSAGE_STORAGE does not exist", () => {
    // given
    mock.module("node:fs", () => ({
      existsSync: mock(() => false),
      readdirSync: mock(() => []),
    }))

    // when
    const result = getMessageDir("ses_123")

    // then
    expect(result).toBe(null)
  })

  it("returns direct path when session exists directly", () => {
    // given
    mock.module("node:fs", () => ({
      existsSync: mock((path: string) => path === "/mock/opencode/storage/message" || path === "/mock/opencode/storage/message/ses_123"),
      readdirSync: mock(() => []),
    }))

    // when
    const result = getMessageDir("ses_123")

    // then
    expect(result).toBe("/mock/opencode/storage/message/ses_123")
  })

  it("returns subdirectory path when session exists in subdirectory", () => {
    // given
    mock.module("node:fs", () => ({
      existsSync: mock((path: string) => path === "/mock/opencode/storage/message" || path === "/mock/opencode/storage/message/subdir/ses_123"),
      readdirSync: mock(() => ["subdir"]),
    }))

    // when
    const result = getMessageDir("ses_123")

    // then
    expect(result).toBe("/mock/opencode/storage/message/subdir/ses_123")
  })

  it("returns null when session not found anywhere", () => {
    // given
    mock.module("node:fs", () => ({
      existsSync: mock((path: string) => path === "/mock/opencode/storage/message"),
      readdirSync: mock(() => ["subdir1", "subdir2"]),
    }))

    // when
    const result = getMessageDir("ses_123")

    // then
    expect(result).toBe(null)
  })

  it("returns null when readdirSync throws", () => {
    // given
    mock.module("node:fs", () => ({
      existsSync: mock((path: string) => path === "/mock/opencode/storage/message"),
      readdirSync: mock(() => {
        throw new Error("Permission denied")
      }),
    }))

    // when
    const result = getMessageDir("ses_123")

    // then
    expect(result).toBe(null)
  })

  it("returns null when isSqliteBackend returns true (beta mode)", async () => {
    // given - mock beta mode (SQLite backend)
    mock.module("./opencode-storage-detection", () => ({
      isSqliteBackend: () => true,
      resetSqliteBackendCache: () => {},
    }))

    // Re-import to get fresh module with mocked isSqliteBackend
    const { getMessageDir: getMessageDirBeta } = await import("./opencode-message-dir")

    // when
    const result = getMessageDirBeta("ses_123")

    // then
    expect(result).toBe(null)
  })
})