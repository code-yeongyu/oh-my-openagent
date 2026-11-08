import { describe, expect, test } from "bun:test"

import { mulberry32 } from "../item/test-support"
import { isOrderedSubsequence, mergeInsertions } from "./index"

describe("isOrderedSubsequence", () => {
  test("accepts interleaved subsequences", () => {
    expect(isOrderedSubsequence("abc", "aXbXc")).toBe(true)
    expect(isOrderedSubsequence("", "anything")).toBe(true)
    expect(isOrderedSubsequence("", "")).toBe(true)
  })

  test("rejects reordered or missing characters", () => {
    expect(isOrderedSubsequence("abc", "acb")).toBe(false)
    expect(isOrderedSubsequence("abc", "ab")).toBe(false)
    expect(isOrderedSubsequence("a", "")).toBe(false)
  })
})

describe("mergeInsertions (sync-design §3 insert-only adoption)", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ["", "", ""],
    ["abc", "abc", "abc"],
    ["", "hello\n", "hello\n"],
    ["hello\n", "", "hello\n"],
    ["abc", "abXc", "abc\nabXc"],
    ["abXc", "abc", "abXc\nabc"],
    ["a c", "a b c", "a c\na b c"],
    ["a x c", "a y c", "a x c\na y c"],
    ["alpha beta\nlast\n", "alpha gamma beta\nlast\n", "alpha beta\nalpha gamma beta\nlast\n"],
    ["one\ntwo\n", "zero\none\ntwo\n", "zero\none\ntwo\n"],
  ]
  for (const [base, incoming, want] of cases) {
    test(`(${JSON.stringify(base)}, ${JSON.stringify(incoming)})`, () => {
      expect(mergeInsertions(base, incoming)).toBe(want)
    })
  }

  test("identical adoption adds nothing", () => {
    const text = "---\ntitle: same\n---\nbody identical\n"
    expect(mergeInsertions(text, text)).toBe(text)
  })

  test("the result is always a common supersequence (seeded property)", () => {
    const rand = mulberry32(20261015)
    const alphabet = ["a", "b", "c", "\n", "d", "e", "f"]
    for (let i = 0; i < 300; i++) {
      const make = () =>
        Array.from({ length: Math.floor(rand() * 60) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("")
      const base = make()
      const incoming = make()
      const merged = mergeInsertions(base, incoming)
      expect(isOrderedSubsequence(base, merged)).toBe(true)
      expect(isOrderedSubsequence(incoming, merged)).toBe(true)
      expect(mergeInsertions(base, incoming)).toBe(merged)
      expect(merged.length).toBeGreaterThanOrEqual(Math.max(base.length, incoming.length))
    }
  })

  test("the line-level fallback keeps the supersequence guarantee", () => {
    const base = "one\ntwo\nthree\n"
    const incoming = "one\nTWO\nthree\nfour\n"
    const merged = mergeInsertions(base, incoming, 1)
    expect(isOrderedSubsequence(base, merged)).toBe(true)
    expect(isOrderedSubsequence(incoming, merged)).toBe(true)
    expect(merged).toContain("four\n")
  })
})
