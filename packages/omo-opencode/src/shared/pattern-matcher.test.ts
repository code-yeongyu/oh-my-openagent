import { describe, test, expect } from "bun:test"
import { matchesToolMatcher, findMatchingHooks } from "./pattern-matcher"
import type { ClaudeHooksConfig } from "../hooks/claude-code-hooks/types"

describe("matchesToolMatcher", () => {
  describe("exact matching", () => {
    //#given a pattern without wildcards
    //#when matching against a tool name
    //#then it should match case-insensitively

    test("matches exact tool name", () => {
      expect(matchesToolMatcher("bash", "bash")).toBe(true)
    })

    test("matches case-insensitively", () => {
      expect(matchesToolMatcher("Bash", "bash")).toBe(true)
      expect(matchesToolMatcher("bash", "BASH")).toBe(true)
    })

    test("does not match different tool names", () => {
      expect(matchesToolMatcher("bash", "edit")).toBe(false)
    })
  })

  describe("wildcard matching", () => {
    //#given a pattern with asterisk wildcard
    //#when matching against tool names
    //#then it should treat * as glob-style wildcard

    test("matches prefix wildcard", () => {
      expect(matchesToolMatcher("lsp_goto_definition", "lsp_*")).toBe(true)
      expect(matchesToolMatcher("lsp_find_references", "lsp_*")).toBe(true)
    })

    test("matches suffix wildcard", () => {
      expect(matchesToolMatcher("file_read", "*_read")).toBe(true)
    })

    test("matches middle wildcard", () => {
      expect(matchesToolMatcher("get_user_info", "get_*_info")).toBe(true)
    })

    test("matches multiple wildcards", () => {
      expect(matchesToolMatcher("get_user_data", "*_user_*")).toBe(true)
    })

    test("single asterisk matches any tool", () => {
      expect(matchesToolMatcher("anything", "*")).toBe(true)
    })
  })

  describe("pipe-separated patterns", () => {
    //#given multiple patterns separated by pipes
    //#when matching against tool names
    //#then it should match if any pattern matches

    test("matches first pattern", () => {
      expect(matchesToolMatcher("bash", "bash | edit | write")).toBe(true)
    })

    test("matches middle pattern", () => {
      expect(matchesToolMatcher("edit", "bash | edit | write")).toBe(true)
    })

    test("matches last pattern", () => {
      expect(matchesToolMatcher("write", "bash | edit | write")).toBe(true)
    })

    test("does not match if none match", () => {
      expect(matchesToolMatcher("read", "bash | edit | write")).toBe(false)
    })
  })

  describe("regex special character escaping (issue #1521)", () => {
    //#given a pattern containing regex special characters
    //#when matching against tool names
    //#then it should NOT throw SyntaxError and should handle them as literals

    test("handles parentheses in pattern without throwing", () => {
      expect(() => matchesToolMatcher("bash", "bash(*)")).not.toThrow()
      expect(matchesToolMatcher("bash(test)", "bash(*)")).toBe(true)
    })

    test("handles unmatched opening parenthesis", () => {
      expect(() => matchesToolMatcher("test", "test(*")).not.toThrow()
      expect(matchesToolMatcher("test(foo", "test(*")).toBe(true)
      expect(matchesToolMatcher("testfoo", "test(*")).toBe(false)
    })

    test("handles unmatched closing parenthesis", () => {
      expect(() => matchesToolMatcher("test", "test*)")).not.toThrow()
      expect(matchesToolMatcher("test)", "test*)")).toBe(true)
      expect(matchesToolMatcher("testanything)", "test*)")).toBe(true)
      expect(matchesToolMatcher("foo)", "test*)")).toBe(false)
    })

    test("handles square brackets", () => {
      expect(() => matchesToolMatcher("test", "test[*]")).not.toThrow()
      expect(matchesToolMatcher("test[1]", "test[*]")).toBe(true)
    })

    test("handles plus sign as literal", () => {
      expect(() => matchesToolMatcher("test", "test+*")).not.toThrow()
      expect(matchesToolMatcher("test+value", "test+*")).toBe(true)
      expect(matchesToolMatcher("testvalue", "test+*")).toBe(false)
    })

    test("handles question mark as literal", () => {
      expect(() => matchesToolMatcher("test", "test?*")).not.toThrow()
      expect(matchesToolMatcher("test?foo", "test?*")).toBe(true)
      expect(matchesToolMatcher("testfoo", "test?*")).toBe(false)
    })

    test("handles caret as literal", () => {
      expect(() => matchesToolMatcher("test", "^test*")).not.toThrow()
      expect(matchesToolMatcher("^test_tool", "^test*")).toBe(true)
      expect(matchesToolMatcher("test_tool", "^test*")).toBe(false)
    })

    test("handles dollar sign as literal", () => {
      expect(() => matchesToolMatcher("test", "test$*")).not.toThrow()
      expect(matchesToolMatcher("test$var", "test$*")).toBe(true)
      expect(matchesToolMatcher("testvar", "test$*")).toBe(false)
    })

    test("handles curly braces as literal", () => {
      expect(() => matchesToolMatcher("test", "test{*}")).not.toThrow()
      expect(matchesToolMatcher("test{foo}", "test{*}")).toBe(true)
      expect(matchesToolMatcher("testfoo", "test{*}")).toBe(false)
    })

    test("handles pipe as pattern separator", () => {
      expect(() => matchesToolMatcher("test", "test|value")).not.toThrow()
      expect(matchesToolMatcher("test", "test|value")).toBe(true)
      expect(matchesToolMatcher("value", "test|value")).toBe(true)
    })

    test("handles backslash as literal", () => {
      expect(() => matchesToolMatcher("test\\path", "test\\*")).not.toThrow()
      expect(matchesToolMatcher("test\\path", "test\\*")).toBe(true)
      expect(matchesToolMatcher("testpath", "test\\*")).toBe(false)
    })

    test("handles dot", () => {
      expect(() => matchesToolMatcher("test.ts", "test.*")).not.toThrow()
      expect(matchesToolMatcher("test.ts", "test.*")).toBe(true)
    })

    test("complex pattern with multiple special chars", () => {
      expect(() => matchesToolMatcher("func(arg)", "func(*)")).not.toThrow()
      expect(matchesToolMatcher("func(arg)", "func(*)")).toBe(true)
    })
  })

  describe("empty matcher", () => {
    //#given an empty or undefined matcher
    //#when matching
    //#then it should match everything

    test("empty string matches everything", () => {
      expect(matchesToolMatcher("anything", "")).toBe(true)
    })
  })
})

describe("findMatchingHooks", () => {
  const mockHooks: ClaudeHooksConfig = {
    PreToolUse: [
      { matcher: "bash", hooks: [{ type: "command", command: "/test/hook1" }] },
      { matcher: "edit*", hooks: [{ type: "command", command: "/test/hook2" }] },
      { matcher: "*", hooks: [{ type: "command", command: "/test/hook3" }] },
    ],
  }

  test("finds hooks matching exact tool name", () => {
    const result = findMatchingHooks(mockHooks, "PreToolUse", "bash")
    expect(result.length).toBe(2) // "bash" and "*"
  })

  test("finds hooks matching wildcard pattern", () => {
    const result = findMatchingHooks(mockHooks, "PreToolUse", "edit_file")
    expect(result.length).toBe(2) // "edit*" and "*"
  })

  test("returns all hooks when no toolName provided", () => {
    const result = findMatchingHooks(mockHooks, "PreToolUse")
    expect(result.length).toBe(3)
  })

  test("returns empty array for non-existent event", () => {
    const result = findMatchingHooks(mockHooks, "PostToolUse", "bash")
    expect(result.length).toBe(0)
  })
})
