import { describe, expect, test } from "bun:test"

import { CLAIMS, NOT_CLAIMS, NUM, parseNumeral, UNIT } from "./numerals.mjs"
import { normalizeUnit } from "./units.mjs"

describe("shared claim patterns", () => {
	test("exports the gate patterns", () => {
		expect(typeof NUM).toBe("string")
		expect(typeof UNIT).toBe("string")
		expect(NOT_CLAIMS.length).toBe(13)
		expect(CLAIMS.length).toBe(4)
	})
})

describe("parseNumeral", () => {
	test("a length with its unit", () => {
		expect(parseNumeral("320 m")).toEqual({ value: "320", raw: "320 m", span: [0, 5], unitRaw: "m", qualifierRaw: null })
		expect(parseNumeral("320 mm")?.unitRaw).toBe("mm")
	})

	test("thousands separators", () => {
		const parsed = parseNumeral("we shipped 1,237 units")
		expect(parsed?.value).toBe("1237")
		expect(parsed?.span).toEqual([11, 16])
	})

	test("Korean scale words fold into the value and leave the currency unit", () => {
		const parsed = parseNumeral("3억 원")
		expect(parsed?.value).toBe("300000000")
		expect(parsed?.raw).toBe("3억 원")
		expect(normalizeUnit(parsed?.unitRaw as string)).toBe(normalizeUnit("원"))
		expect(parseNumeral("4조 2,000억 원")?.value).toBe("4200000000000")
		expect(parseNumeral("3천만 원")?.value).toBe("30000000")
	})

	test("Latin suffixes and scale words", () => {
		expect(parseNumeral("1.2k")?.value).toBe("1200")
		expect(parseNumeral("$3M")).toMatchObject({ value: "3000000", raw: "$3M", unitRaw: "$" })
		expect(parseNumeral("2.5bn")?.value).toBe("2500000000")
		expect(parseNumeral("$4B")?.value).toBe("4000000000")
		expect(parseNumeral("3 million users")?.value).toBe("3000000")
		expect(parseNumeral("5 km")).toMatchObject({ value: "5", unitRaw: "km" })
	})

	test("percent and percentage points stay distinct", () => {
		expect(parseNumeral("15.2%")).toMatchObject({ value: "15.2", unitRaw: "%" })
		expect(parseNumeral("2%p")).toMatchObject({ value: "2", unitRaw: "%p" })
	})

	test("long decimals keep every digit", () => {
		expect(parseNumeral("10000000000000000.1")?.value).toBe("10000000000000000.1")
	})

	test("English number words one to twelve only", () => {
		expect(parseNumeral("three engineers")?.value).toBe("3")
		expect(parseNumeral("Twelve")?.value).toBe("12")
		expect(parseNumeral("thirteen")).toBeNull()
	})

	test("qualifiers before and after the value", () => {
		expect(parseNumeral("최대 4조 2,000억 원")).toMatchObject({ value: "4200000000000", qualifierRaw: "최대", span: [3, 14] })
		expect(parseNumeral("up to 320 m")?.qualifierRaw).toBe("up to")
		expect(parseNumeral("320 m 이상")?.qualifierRaw).toBe("이상")
		expect(parseNumeral("the 320 m mast")?.qualifierRaw).toBeNull()
	})

	test("dates, versions and figure references are not numerals", () => {
		expect(parseNumeral("v2.3.1")).toBeNull()
		expect(parseNumeral("see figure 3")).toBeNull()
		expect(parseNumeral("2026-10-23")).toBeNull()
		expect(parseNumeral("v2.3.1 shipped 40 fixes")?.value).toBe("40")
	})

	test("year-shaped values next to a currency, scale word or unit, or with a decimal part, are numerals", () => {
		expect(parseNumeral("2000억 원")).toMatchObject({ value: "200000000000", unitRaw: "원" })
		expect(parseNumeral("1900만 원")).toMatchObject({ value: "19000000", unitRaw: "원" })
		expect(parseNumeral("2050명")).toMatchObject({ value: "2050", unitRaw: "명" })
		expect(parseNumeral("$2000")).toMatchObject({ value: "2000", raw: "$2000", unitRaw: "$" })
		expect(parseNumeral("1999 users")?.value).toBe("1999")
		expect(parseNumeral("1234.56 m")).toMatchObject({ value: "1234.56", unitRaw: "m" })
		expect(parseNumeral("$1500.25")).toMatchObject({ value: "1500.25", unitRaw: "$" })
		expect(parseNumeral("2020.5억")?.value).toBe("202050000000")
	})

	test("bare years and dates stay excluded", () => {
		expect(parseNumeral("in 2020")).toBeNull()
		expect(parseNumeral("2020-03-01")).toBeNull()
		expect(parseNumeral("the 2020s")).toBeNull()
		expect(parseNumeral("in 2020, 5 users")?.value).toBe("5")
	})

	test("a leading minus sign is part of the value and the span", () => {
		expect(parseNumeral("-5%")).toMatchObject({ value: "-5", raw: "-5%", span: [0, 3], unitRaw: "%" })
		expect(parseNumeral("fell \u22123.2%")).toMatchObject({ value: "-3.2", span: [5, 10], unitRaw: "%" })
		expect(parseNumeral("COVID-19 cases")?.value).toBe("19")
	})

	test("ranges carry both endpoints and share the unit", () => {
		expect(parseNumeral("5-10 m")).toMatchObject({ value: "5", valueEnd: "10", range: true, raw: "5-10 m", span: [0, 6], unitRaw: "m" })
		expect(parseNumeral("5 to 10 m")).toMatchObject({ value: "5", valueEnd: "10", range: true, raw: "5 to 10 m", unitRaw: "m" })
		expect(parseNumeral("5~10%")).toMatchObject({ value: "5", valueEnd: "10", range: true, unitRaw: "%" })
		expect(parseNumeral("5\u201310%")).toMatchObject({ value: "5", valueEnd: "10", range: true, unitRaw: "%" })
		expect(parseNumeral("3~5억 원")).toMatchObject({ value: "300000000", valueEnd: "500000000", range: true, unitRaw: "원" })
		expect(parseNumeral("320 m")).not.toHaveProperty("valueEnd")
	})

	test("Korean scale words and units need a word boundary", () => {
		expect(parseNumeral("5조각")).toMatchObject({ value: "5", raw: "5", unitRaw: null })
		expect(parseNumeral("3분의 1")).toMatchObject({ value: "3", raw: "3", unitRaw: null })
		expect(parseNumeral("3분의 휴식")?.unitRaw).toBe("분")
		expect(parseNumeral("매출 10억은")?.value).toBe("1000000000")
	})

	test("from skips earlier numerals", () => {
		const text = "320 m and 15%"
		const first = parseNumeral(text)
		expect(parseNumeral(text, first?.span[1])).toMatchObject({ value: "15", unitRaw: "%" })
		expect(parseNumeral("no numbers here")).toBeNull()
	})
})
