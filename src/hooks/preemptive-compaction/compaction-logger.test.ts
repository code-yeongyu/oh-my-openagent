import { describe, it, expect, mock, beforeEach } from "bun:test"
import { getCompactionLogPath } from "./compaction-logger"

// Since we can't easily mock node:fs for appendFileSync in bun:test,
// we'll test the pure functions and verify the log path structure

describe("compaction-logger", () => {
  describe("getCompactionLogPath", () => {
    it("#then should return a path ending with compaction.log", () => {
      const logPath = getCompactionLogPath()
      expect(logPath).toContain("compaction.log")
    })

    it("#then should be in opencode storage directory", () => {
      const logPath = getCompactionLogPath()
      expect(logPath).toContain("opencode")
    })
  })

  // Note: logCompaction and clearCompactionLog are thin wrappers around fs operations
  // with silent error handling. Testing them requires file system access or complex
  // module mocking. The key behaviors are:
  // 1. Formats log entries correctly (covered by integration)
  // 2. Never throws errors (error handling is silent)
  // 3. Uses correct log file path (verified above)
  
  // The formatting logic is verified through integration testing and manual inspection
  // of the log output format documented in the implementation.
})
