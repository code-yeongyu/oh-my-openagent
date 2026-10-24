import { describe, expect, test } from "bun:test"

import { convertFactor, dimensionOf, koreanReadingOf, normalizeUnit } from "./units.mjs"

describe("normalizeUnit", () => {
	test("ignores whitespace and spelling variants", () => {
		expect(normalizeUnit("억 원")).toBe(normalizeUnit("억원"))
		expect(normalizeUnit("억원")).not.toBeNull()
		expect(normalizeUnit("million")).toBe(normalizeUnit("M"))
		expect(normalizeUnit("USD")).toBe(normalizeUnit("$"))
		expect(normalizeUnit("달러")).toBe(normalizeUnit("USD"))
		expect(normalizeUnit("%")).not.toBe(normalizeUnit("%p"))
		expect(normalizeUnit("m")).not.toBe(normalizeUnit("M"))
		expect(normalizeUnit("furlongs")).toBeNull()
	})

	test("a normalized token normalizes to itself", () => {
		for (const raw of ["억 원", "m", "kg", "GB", "%p", "USD", "C", "F"]) {
			const token = normalizeUnit(raw)
			expect(normalizeUnit(token as string)).toBe(token)
		}
	})
})

describe("dimensionOf and convertFactor", () => {
	test("length, mass, time and data convert exactly", () => {
		expect(convertFactor("m", "mm")).toEqual({ num: 1000n, den: 1n })
		expect(convertFactor("mm", "m")).toEqual({ num: 1n, den: 1000n })
		expect(convertFactor("km", "cm")).toEqual({ num: 100000n, den: 1n })
		expect(convertFactor("kg", "t")).toEqual({ num: 1n, den: 1000n })
		expect(convertFactor("h", "s")).toEqual({ num: 3600n, den: 1n })
		expect(convertFactor("GB", "MB")).toEqual({ num: 1000n, den: 1n })
		expect(dimensionOf(normalizeUnit("cm") as string)).toBe("length")
	})

	test("the Korean currency scales convert within one currency", () => {
		expect(convertFactor("억 원", "원")).toEqual({ num: 100000000n, den: 1n })
		expect(convertFactor("조원", "억원")).toEqual({ num: 10000n, den: 1n })
	})

	test("currency is never converted across currencies, and dimensions never mix", () => {
		expect(convertFactor("USD", "KRW")).toBeNull()
		expect(convertFactor("m", "kg")).toBeNull()
		expect(convertFactor("%", "%p")).toBeNull()
		expect(convertFactor("m", "furlongs")).toBeNull()
	})

	test("temperature is affine", () => {
		expect(convertFactor("C", "F")).toEqual({ num: 9n, den: 5n, offset: { num: 32n, den: 1n } })
		expect(convertFactor("F", "C")).toEqual({ num: 5n, den: 9n, offset: { num: -160n, den: 9n } })
	})
})

describe("koreanReadingOf", () => {
	const cases: Array<[string, string]> = [
		["%", "open"],
		["%p", "open"],
		["m", "open"],
		["km", "open"],
		["원", "closed"],
		["달러", "open"],
		["유로", "open"],
		["엔", "closed"],
		["배", "open"],
		["건", "closed"],
		["명", "closed"],
		["조", "open"],
		["억", "closed"],
		["만", "closed"],
		["천", "closed"],
		["kg", "closed"],
		["GB", "open"],
	]
	for (const [raw, reading] of cases) {
		test(`${raw} reads ${reading}`, () => {
			expect(koreanReadingOf(raw)).toBe(reading)
		})
	}

	test("unknown units have no reading", () => {
		expect(koreanReadingOf("furlongs")).toBeNull()
	})
})
