import { describe, test, expect, mock, beforeEach } from "bun:test"
import { truncateUntilTargetTokens } from "./storage"
import * as storage from "./storage"

// Mock the entire module
mock.module("./storage", () => {
  return {
    ...storage,
    findToolResultsBySize: mock(() => []),
    truncateToolResult: mock(() => ({ success: false })),
  }
})

describe("truncateUntilTargetTokens", () => {
  const sessionID = "test-session"
  
  beforeEach(() => {
    // Reset mocks
    const { findToolResultsBySize, truncateToolResult } = require("./storage")
    findToolResultsBySize.mockReset()
    truncateToolResult.mockReset()
  })

  test("truncates only until target is reached", () => {
    const { findToolResultsBySize, truncateToolResult } = require("./storage")
    
    // #given: Two tool results, each 1000 chars. Target reduction is 500 chars.
    const results = [
      { partPath: "path1", partId: "id1", messageID: "m1", toolName: "tool1", outputSize: 1000 },
      { partPath: "path2", partId: "id2", messageID: "m2", toolName: "tool2", outputSize: 1000 },
    ]
    
    findToolResultsBySize.mockReturnValue(results)
    truncateToolResult.mockImplementation((path: string) => ({
      success: true,
      toolName: path === "path1" ? "tool1" : "tool2",
      originalSize: 1000
    }))

    // #when: currentTokens=1000, maxTokens=1000, targetRatio=0.5 (target=500, reduce=500)
    // charsPerToken=1 for simplicity in test
    const result = truncateUntilTargetTokens(sessionID, 1000, 1000, 0.5, 1)

    // #then: Should only truncate the first tool
    expect(result.truncatedCount).toBe(1)
    expect(truncateToolResult).toHaveBeenCalledTimes(1)
    expect(truncateToolResult).toHaveBeenCalledWith("path1")
    expect(result.totalBytesRemoved).toBe(1000)
    expect(result.sufficient).toBe(true)
  })

  test("truncates all if target not reached", () => {
    const { findToolResultsBySize, truncateToolResult } = require("./storage")
    
    // #given: Two tool results, each 100 chars. Target reduction is 500 chars.
    const results = [
      { partPath: "path1", partId: "id1", messageID: "m1", toolName: "tool1", outputSize: 100 },
      { partPath: "path2", partId: "id2", messageID: "m2", toolName: "tool2", outputSize: 100 },
    ]
    
    findToolResultsBySize.mockReturnValue(results)
    truncateToolResult.mockImplementation((path: string) => ({
      success: true,
      toolName: path === "path1" ? "tool1" : "tool2",
      originalSize: 100
    }))

    // #when: reduce 500 chars
    const result = truncateUntilTargetTokens(sessionID, 1000, 1000, 0.5, 1)

    // #then: Should truncate both
    expect(result.truncatedCount).toBe(2)
    expect(truncateToolResult).toHaveBeenCalledTimes(2)
    expect(result.totalBytesRemoved).toBe(200)
    expect(result.sufficient).toBe(false)
  })
})
