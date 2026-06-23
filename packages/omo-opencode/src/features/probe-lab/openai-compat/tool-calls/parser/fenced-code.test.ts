import { describe, expect, test } from "bun:test"
import { stripFencedCode } from "./fenced-code"

describe("stripFencedCode", () => {
  describe("#given a single ``` block surrounded by prose", () => {
    test("#when stripped #then prose preserved and block replaced with whitespace", () => {
      const text = "Hello\n```\ncode here\n```\nWorld"
      const r = stripFencedCode(text)
      expect(r.clean).toContain("Hello")
      expect(r.clean).toContain("World")
      expect(r.clean).not.toContain("code here")
      expect(r.fencedRanges.length).toBe(1)
    })
  })

  describe("#given a single ~~~ block", () => {
    test("#when stripped #then block content removed", () => {
      const text = "before\n~~~\nsecret\n~~~\nafter"
      const r = stripFencedCode(text)
      expect(r.clean).toContain("before")
      expect(r.clean).toContain("after")
      expect(r.clean).not.toContain("secret")
      expect(r.fencedRanges.length).toBe(1)
    })
  })

  describe("#given mixed ``` and ~~~ blocks in same content", () => {
    test("#when stripped #then both blocks removed", () => {
      const text = "x\n```\nA\n```\nmid\n~~~\nB\n~~~\ny"
      const r = stripFencedCode(text)
      expect(r.clean).toContain("x")
      expect(r.clean).toContain("mid")
      expect(r.clean).toContain("y")
      expect(r.clean).not.toContain("A")
      expect(r.clean).not.toContain("B")
      expect(r.fencedRanges.length).toBe(2)
    })
  })

  describe("#given DSML block inside fenced ``` code", () => {
    test("#when stripped #then DSML markup is gone from clean output", () => {
      const text = "ex\n```\n<|DSML|tool_calls>foo</|DSML|tool_calls>\n```\nend"
      const r = stripFencedCode(text)
      expect(r.clean).not.toContain("<|DSML|tool_calls>")
      expect(r.clean).not.toContain("foo")
      expect(r.clean).toContain("ex")
      expect(r.clean).toContain("end")
    })
  })

  describe("#given content with no fences at all", () => {
    test("#when stripped #then text returned unchanged with empty ranges", () => {
      const text = "no fences here"
      const r = stripFencedCode(text)
      expect(r.clean).toBe(text)
      expect(r.fencedRanges.length).toBe(0)
    })
  })

  describe("#given language specifier on opening fence", () => {
    test("#when stripped #then block still removed", () => {
      const text = "x\n```typescript\nconst x = 1\n```\ny"
      const r = stripFencedCode(text)
      expect(r.clean).toContain("x")
      expect(r.clean).toContain("y")
      expect(r.clean).not.toContain("const x = 1")
    })
  })

  describe("#given an unterminated fence", () => {
    test("#when stripped #then content returned essentially intact (no closing match)", () => {
      const text = "x\n```\nopen but never closes"
      const r = stripFencedCode(text)
      expect(r.clean).toContain("x")
      expect(r.fencedRanges.length).toBe(0)
    })
  })

  describe("#given empty string input", () => {
    test("#when stripped #then empty result with no ranges", () => {
      const r = stripFencedCode("")
      expect(r.clean).toBe("")
      expect(r.fencedRanges.length).toBe(0)
    })
  })
})
