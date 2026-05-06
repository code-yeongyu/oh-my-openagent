/// <reference path="../../../../bun-test.d.ts" />

import { describe, test, expect } from "bun:test"
import { BTW_TEMPLATE } from "./btw"

describe("BTW_TEMPLATE", () => {
  test("should declare its purpose as a side-question command", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("BTW Command")
    expect(BTW_TEMPLATE).toContain("side question")
  })

  test("should forbid mutating the main todo list and task flow", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("MUST NOT be added to the active todo list")
    expect(BTW_TEMPLATE).toContain("Do NOT add it to the existing todo list")
    expect(BTW_TEMPLATE).toContain("DO NOT modify files, branches, or commits because of /btw")
  })

  test("should provide a usage hint for empty invocation", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("Usage: /btw <question>")
  })

  test("should instruct delegation to a fresh subagent session via task tool", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("DELEGATE TO A SEPARATE SESSION")
    expect(BTW_TEMPLATE).toContain("task tool")
    expect(BTW_TEMPLATE).toContain("run_in_background: false")
  })

  test("should recommend lightweight categories by default", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain('"quick"')
    expect(BTW_TEMPLATE).toContain('"unspecified-low"')
  })

  test("should require concise relayed output and a resume marker", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("Side answer (not added to main task):")
    expect(BTW_TEMPLATE).toContain("Resuming main task.")
  })

  test("should allow direct answer for trivial questions without delegation", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).toContain("answer directly without delegation")
  })

  test("should not contain emojis", () => {
    //#given - the template string

    //#when / #then
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    expect(emojiRegex.test(BTW_TEMPLATE)).toBe(false)
  })

  test("should not use em or en dashes", () => {
    //#given - the template string

    //#when / #then
    expect(BTW_TEMPLATE).not.toContain("\u2014")
    expect(BTW_TEMPLATE).not.toContain("\u2013")
  })
})
