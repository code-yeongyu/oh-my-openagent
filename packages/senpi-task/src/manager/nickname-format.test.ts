import { expect, test } from "bun:test"

import { formatTaskNickname } from "./nickname-format"

test("the first task occurrence keeps its base nickname", () => {
  expect(formatTaskNickname("Selene", 1, "full")).toBe("Selene")
})

test("formats repeated nicknames in each supported style", () => {
  expect(formatTaskNickname("Selene", 22, "#")).toBe("Selene #22")
  expect(formatTaskNickname("Selene", 22, "roman")).toBe("Selene XXII")
  expect(formatTaskNickname("Selene", 22, "full")).toBe("Selene the Twenty-Second")
  expect(formatTaskNickname("Selene", 22, "arabic")).toBe("Selene the 22nd")
})

test("Roman numerals fall back to the numeric marker above 3999", () => {
  expect(formatTaskNickname("Selene", 3999, "roman")).toBe("Selene MMMCMXCIX")
  expect(formatTaskNickname("Selene", 4000, "roman")).toBe("Selene #4000")
})

test("English ordinals spell scale boundaries and compose lower groups", () => {
  expect(formatTaskNickname("Selene", 100, "full")).toBe("Selene the One Hundredth")
  expect(formatTaskNickname("Selene", 1000, "full")).toBe("Selene the One Thousandth")
  expect(formatTaskNickname("Selene", 1001, "full")).toBe("Selene the One Thousand First")
  expect(formatTaskNickname("Selene", 22, "full")).toBe("Selene the Twenty-Second")
  expect(formatTaskNickname("Selene", 9_000_000_000_000_000, "full")).toBe(
    "Selene the Nine Quadrillionth",
  )
  expect(formatTaskNickname("Selene", Number.MAX_SAFE_INTEGER, "full")).toBe(
    "Selene #9007199254740991",
  )
})

test("an overflowing preferred label falls back to full base plus numeric occurrence", () => {
  const base = "a".repeat(20)
  expect(formatTaskNickname(base, 22, "full")).toBe(`${base} #22`)
})

test("Arabic ordinal suffixes handle teens and safe-integer values", () => {
  expect(formatTaskNickname("Selene", 11, "arabic")).toBe("Selene the 11th")
  expect(formatTaskNickname("Selene", 21, "arabic")).toBe("Selene the 21st")
  expect(formatTaskNickname("Selene", 112, "arabic")).toBe("Selene the 112th")
  expect(formatTaskNickname("Selene", Number.MAX_SAFE_INTEGER, "arabic")).toBe(
    "Selene the 9007199254740991st",
  )
})

test("nickname length is capped by UTF-16 units without splitting graphemes or suffixes", () => {
  const family = "👩‍👩‍👧‍👦"
  const formatted = formatTaskNickname(`${"a".repeat(25)}${family}`, 2, "#")
  expect(formatted).toBe(`${"a".repeat(25)} #2`)
  expect(formatted.length).toBeLessThanOrEqual(32)
  expect(formatTaskNickname("a".repeat(40), 1, "roman")).toBe("a".repeat(32))
})

test("only the final fallback truncates the base and removes trailing whitespace", () => {
  const base = `${"a".repeat(26)}   ${"b".repeat(20)}`
  expect(formatTaskNickname(base, 2, "full")).toBe(`${"a".repeat(26)} #2`)
})

test("invalid occurrence numbers fail at the formatter boundary", () => {
  for (const occurrence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => formatTaskNickname("Selene", occurrence, "roman")).toThrow(RangeError)
  }
})
