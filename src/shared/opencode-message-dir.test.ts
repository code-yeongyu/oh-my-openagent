import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getMessageDir } from "./opencode-message-dir"

// Mock the constants
vi.mock("../tools/session-manager/constants", () => ({
  MESSAGE_STORAGE: "/mock/message/storage",
}))

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}))

vi.mock("node:path", () => ({
  join: vi.fn(),
}))

const mockExistsSync = vi.mocked(existsSync)
const mockReaddirSync = vi.mocked(readdirSync)
const mockJoin = vi.mocked(join)

describe("getMessageDir", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJoin.mockImplementation((...args) => args.join("/"))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns null when MESSAGE_STORAGE does not exist", () => {
    // given
    mockExistsSync.mockReturnValue(false)

    // when
    const result = getMessageDir("session123")

    // then
    expect(result).toBe(null)
    expect(mockExistsSync).toHaveBeenCalledWith("/mock/message/storage")
  })

  it("returns direct path when session exists directly", () => {
    // given
    mockExistsSync.mockImplementation((path) => path === "/mock/message/storage" || path === "/mock/message/storage/session123")

    // when
    const result = getMessageDir("session123")

    // then
    expect(result).toBe("/mock/message/storage/session123")
    expect(mockExistsSync).toHaveBeenCalledWith("/mock/message/storage")
    expect(mockExistsSync).toHaveBeenCalledWith("/mock/message/storage/session123")
  })

  it("returns subdirectory path when session exists in subdirectory", () => {
    // given
    mockExistsSync.mockImplementation((path) => {
      return path === "/mock/message/storage" || path === "/mock/message/storage/subdir/session123"
    })
    mockReaddirSync.mockReturnValue(["subdir"])

    // when
    const result = getMessageDir("session123")

    // then
    expect(result).toBe("/mock/message/storage/subdir/session123")
    expect(mockReaddirSync).toHaveBeenCalledWith("/mock/message/storage")
  })

  it("returns null when session not found anywhere", () => {
    // given
    mockExistsSync.mockImplementation((path) => path === "/mock/message/storage")
    mockReaddirSync.mockReturnValue(["subdir1", "subdir2"])

    // when
    const result = getMessageDir("session123")

    // then
    expect(result).toBe(null)
  })

  it("returns null when readdirSync throws", () => {
    // given
    mockExistsSync.mockImplementation((path) => path === "/mock/message/storage")
    mockReaddirSync.mockImplementation(() => {
      throw new Error("Permission denied")
    })

    // when
    const result = getMessageDir("session123")

    // then
    expect(result).toBe(null)
  })
})