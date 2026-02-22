const { describe, expect, test } = require("bun:test")

const { deepSanitizeSurrogates, sanitizeSurrogates } = require("./sanitize-surrogates")

describe("sanitizeSurrogates", () => {
  test("returns empty string unchanged", () => {
    expect(sanitizeSurrogates("")).toBe("")
  })

  test("returns ASCII text unchanged", () => {
    expect(sanitizeSurrogates("hello world")).toBe("hello world")
  })

  test("returns Korean text unchanged", () => {
    expect(sanitizeSurrogates("안녕하세요")).toBe("안녕하세요")
  })

  test("replaces lone high surrogate", () => {
    expect(sanitizeSurrogates("\uD800")).toBe("\uFFFD")
  })

  test("replaces lone low surrogate", () => {
    expect(sanitizeSurrogates("\uDC00")).toBe("\uFFFD")
  })

  test("preserves valid surrogate pair", () => {
    const pair = "\uD83D\uDE00"
    expect(sanitizeSurrogates(pair)).toBe(pair)
  })

  test("replaces lone surrogate in middle of string", () => {
    expect(sanitizeSurrogates("hello\uD800world")).toBe("hello\uFFFDworld")
  })
})

describe("deepSanitizeSurrogates", () => {
  test("sanitizes nested strings in objects and arrays", () => {
    const input = {
      message: "ok\uD800",
      nested: {
        items: ["a\uDC00", "\uD83D\uDE00"],
      },
      metadata: {
        count: 1,
        flag: true,
      },
    }

    expect(deepSanitizeSurrogates(input)).toEqual({
      message: "ok\uFFFD",
      nested: {
        items: ["a\uFFFD", "\uD83D\uDE00"],
      },
      metadata: {
        count: 1,
        flag: true,
      },
    })
  })

  test("returns null and undefined as-is", () => {
    expect(deepSanitizeSurrogates(null)).toBeNull()
    expect(deepSanitizeSurrogates(undefined)).toBeUndefined()
  })
})

export {}
