import { describe, expect, test } from "bun:test"

import { add, div, eq, fromDecimal, mul, sigFigsOf, sub, toDecimal } from "./rational.mjs"

describe("rational", () => {
	test("keeps every digit of a long decimal through multiplication", () => {
		const product = mul(fromDecimal("10000000000000000.1"), fromDecimal("3"))
		expect(toDecimal(product)).toBe("30000000000000000.3")
	})

	test("rounds a recurring quotient to the requested significant figures", () => {
		expect(toDecimal(div(fromDecimal("1"), fromDecimal("3")), 3)).toBe("0.333")
		expect(toDecimal(div(fromDecimal("2"), fromDecimal("3")), 2)).toBe("0.67")
		expect(toDecimal(fromDecimal("319999"), 2)).toBe("320000")
		expect(toDecimal(fromDecimal("-2.5"), 1)).toBe("-3")
	})

	test("refuses an exact decimal for a recurring value", () => {
		expect(() => toDecimal(div(fromDecimal("1"), fromDecimal("3")))).toThrow(RangeError)
	})

	test("add, sub and eq work on reduced fractions", () => {
		const third = div(fromDecimal("1"), fromDecimal("3"))
		expect(eq(add(third, add(third, third)), fromDecimal("1"))).toBe(true)
		expect(toDecimal(sub(fromDecimal("0.3"), fromDecimal("0.1")))).toBe("0.2")
		expect(eq(fromDecimal("1.50"), fromDecimal("1.5"))).toBe(true)
		expect(eq(fromDecimal("1.5"), fromDecimal("1.6"))).toBe(false)
	})

	test("never routes values through floating point", () => {
		const r = fromDecimal("0.1")
		expect(typeof r.num).toBe("bigint")
		expect(typeof r.den).toBe("bigint")
		expect(() => fromDecimal("1e3")).toThrow()
		expect(() => div(fromDecimal("1"), fromDecimal("0"))).toThrow(RangeError)
	})

	test("counts significant figures: decimals from the first nonzero digit, integers every digit", () => {
		expect(sigFigsOf("3.2")).toBe(2)
		expect(sigFigsOf("0.050")).toBe(2)
		expect(sigFigsOf("320")).toBe(3)
		expect(sigFigsOf("100")).toBe(3)
		expect(sigFigsOf("20")).toBe(2)
		expect(sigFigsOf("-1.0")).toBe(2)
	})
})
