import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { isSqliteBackend, resetSqliteBackendCache } from "./opencode-storage-detection"
import { getDataDir } from "./data-path"
import { isOpenCodeVersionAtLeast, OPENCODE_SQLITE_VERSION } from "./opencode-version"

// Mock the dependencies
const mockExistsSync = vi.fn()
const mockGetDataDir = vi.fn()
const mockIsOpenCodeVersionAtLeast = vi.fn()

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
}))

vi.mock("./data-path", () => ({
  getDataDir: mockGetDataDir,
}))

vi.mock("./opencode-version", () => ({
  isOpenCodeVersionAtLeast: mockIsOpenCodeVersionAtLeast,
  OPENCODE_SQLITE_VERSION: "1.1.53",
}))

describe("isSqliteBackend", () => {
  beforeEach(() => {
    // Reset the cached result
    resetSqliteBackendCache()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns false when version is below threshold", () => {
    // given
    mockIsOpenCodeVersionAtLeast.mockReturnValue(false)
    mockGetDataDir.mockReturnValue("/home/user/.local/share")
    mockExistsSync.mockReturnValue(true)

    // when
    const result = isSqliteBackend()

    // then
    expect(result).toBe(false)
    expect(mockIsOpenCodeVersionAtLeast).toHaveBeenCalledWith(OPENCODE_SQLITE_VERSION)
  })

  it("returns false when DB file does not exist", () => {
    // given
    mockIsOpenCodeVersionAtLeast.mockReturnValue(true)
    mockGetDataDir.mockReturnValue("/home/user/.local/share")
    mockExistsSync.mockReturnValue(false)

    // when
    const result = isSqliteBackend()

    // then
    expect(result).toBe(false)
    expect(mockExistsSync).toHaveBeenCalledWith(join("/home/user/.local/share", "opencode", "opencode.db"))
  })

  it("returns true when version is at or above threshold and DB exists", () => {
    // given
    mockIsOpenCodeVersionAtLeast.mockReturnValue(true)
    mockGetDataDir.mockReturnValue("/home/user/.local/share")
    mockExistsSync.mockReturnValue(true)

    // when
    const result = isSqliteBackend()

    // then
    expect(result).toBe(true)
    expect(mockIsOpenCodeVersionAtLeast).toHaveBeenCalledWith(OPENCODE_SQLITE_VERSION)
    expect(mockExistsSync).toHaveBeenCalledWith(join("/home/user/.local/share", "opencode", "opencode.db"))
  })

  it("caches the result and does not re-check on subsequent calls", () => {
    // given
    mockIsOpenCodeVersionAtLeast.mockReturnValue(true)
    mockGetDataDir.mockReturnValue("/home/user/.local/share")
    mockExistsSync.mockReturnValue(true)

    // when
    isSqliteBackend()
    isSqliteBackend()
    isSqliteBackend()

    // then
    expect(mockIsOpenCodeVersionAtLeast).toHaveBeenCalledTimes(1)
    expect(mockExistsSync).toHaveBeenCalledTimes(1)
  })
})