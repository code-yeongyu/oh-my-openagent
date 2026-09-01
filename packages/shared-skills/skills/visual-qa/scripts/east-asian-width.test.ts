import { describe, expect, test } from "bun:test"

import { charWidth, stringWidth } from "./east-asian-width"

describe("charWidth", () => {
	test("#given an ASCII letter #when measured #then it is one column", () => {
		// given / when / then
		expect(charWidth(0x61)).toBe(1)
	})

	test("#given a Hangul syllable #when measured #then it is two columns", () => {
		expect(charWidth(0xac00)).toBe(2)
	})

	test("#given a CJK ideograph #when measured #then it is two columns", () => {
		expect(charWidth(0x4e00)).toBe(2)
	})

	test("#given a fullwidth Latin letter #when measured #then it is two columns", () => {
		expect(charWidth(0xff21)).toBe(2)
	})

	test("#given a halfwidth katakana #when measured #then it is one column", () => {
		expect(charWidth(0xff71)).toBe(1)
	})

	test("#given a combining diacritic #when measured #then it is zero columns", () => {
		expect(charWidth(0x0301)).toBe(0)
	})

	test("#given a zero-width space #when measured #then it is zero columns", () => {
		expect(charWidth(0x200b)).toBe(0)
	})

	test("#given an emoji #when measured #then it is two columns", () => {
		expect(charWidth(0x1f600)).toBe(2)
	})
})

describe("stringWidth", () => {
	test("#given an ASCII string #when measured #then width equals character count", () => {
		expect(stringWidth("hello")).toBe(5)
	})

	test("#given Hangul text #when measured #then each syllable counts as two", () => {
		expect(stringWidth("가나다")).toBe(6)
	})

	test("#given CJK text #when measured #then each ideograph counts as two", () => {
		expect(stringWidth("日本語")).toBe(6)
	})

	test("#given a base letter plus a combining mark #when measured #then it is one column", () => {
		expect(stringWidth("e\u0301")).toBe(1)
	})

	test("#given mixed ASCII and CJK #when measured #then widths add up", () => {
		expect(stringWidth("AB가")).toBe(4)
	})
})
