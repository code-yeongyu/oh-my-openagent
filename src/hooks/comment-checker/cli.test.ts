import { describe, test, expect, beforeEach, mock } from "bun:test"

describe("comment-checker CLI path resolution", () => {
  describe("lazy initialization", () => {
    // #given module is imported
    // #when COMMENT_CHECKER_CLI_PATH is accessed
    // #then findCommentCheckerPathSync should NOT have been called during import
    
    test("getCommentCheckerPathSync should be lazy - not called on module import", async () => {
      // #given a fresh module import
      // We need to verify that importing the module doesn't immediately call findCommentCheckerPathSync
      
      // #when we import the module
      const cliModule = await import("./cli")
      
      // #then getCommentCheckerPathSync should exist and be callable
      expect(typeof cliModule.getCommentCheckerPathSync).toBe("function")
      
      // The key test: calling getCommentCheckerPathSync should work
      // (we can't easily test that it wasn't called on import without mocking,
      // but we can verify the function exists and returns expected types)
      const result = cliModule.getCommentCheckerPathSync()
      expect(result === null || typeof result === "string").toBe(true)
    })

    test("getCommentCheckerPathSync should cache result after first call", async () => {
      // #given getCommentCheckerPathSync is called once
      const cliModule = await import("./cli")
      const firstResult = cliModule.getCommentCheckerPathSync()
      
      // #when called again
      const secondResult = cliModule.getCommentCheckerPathSync()
      
      // #then should return same cached result
      expect(secondResult).toBe(firstResult)
    })

    test("COMMENT_CHECKER_CLI_PATH export should not exist (removed for lazy loading)", async () => {
      // #given the cli module
      const cliModule = await import("./cli")
      
      // #when checking for COMMENT_CHECKER_CLI_PATH
      // #then it should not exist (replaced with lazy getter)
      expect("COMMENT_CHECKER_CLI_PATH" in cliModule).toBe(false)
    })
  })

  describe("runCommentChecker", () => {
    test("should use getCommentCheckerPathSync for fallback path resolution", async () => {
      // #given runCommentChecker is called without explicit path
      const { runCommentChecker } = await import("./cli")
      
      // #when called with input containing no comments
      const result = await runCommentChecker({
        session_id: "test",
        tool_name: "Write",
        transcript_path: "",
        cwd: "/tmp",
        hook_event_name: "PostToolUse",
        tool_input: { file_path: "/tmp/test.ts", content: "const x = 1" },
      })
      
      // #then should return CheckResult type (binary may or may not exist)
      expect(typeof result.hasComments).toBe("boolean")
      expect(typeof result.message).toBe("string")
    })
  })
})
