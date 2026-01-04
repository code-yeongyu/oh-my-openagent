import { shouldRunCommentChecker } from "./index"

describe("comment-checker gating", () => {
  it("#then returns true when content includes line comments", () => {
    expect(
      shouldRunCommentChecker({
        filePath: "/tmp/example.ts",
        content: "const x = 1 // comment",
        tool: "write",
        sessionID: "s1",
        timestamp: Date.now(),
      })
    ).toBe(true)
  })

  it("#then returns true when edits include hash comments", () => {
    expect(
      shouldRunCommentChecker({
        filePath: "/tmp/example.py",
        edits: [{ old_string: "a", new_string: "# comment" }],
        tool: "multiedit",
        sessionID: "s1",
        timestamp: Date.now(),
      })
    ).toBe(true)
  })

  it("#then returns false when no comment markers are present", () => {
    expect(
      shouldRunCommentChecker({
        filePath: "/tmp/example.ts",
        newString: "const value = 2",
        tool: "edit",
        sessionID: "s1",
        timestamp: Date.now(),
      })
    ).toBe(false)
  })
})
