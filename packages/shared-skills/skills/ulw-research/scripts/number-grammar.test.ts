import { describe, expect, test } from "bun:test"

import { NUMBER_SOURCE, groupedNumberSource, plainDecimal } from "./number-grammar.mjs"
import { parseNumeral } from "./numerals.mjs"

const numbers = (text: string) => [...text.matchAll(new RegExp(NUMBER_SOURCE, "g"))].map((match) => match[0])

describe("the one grouped-number grammar", () => {
	for (const [text, expected] of [
		["12,3451", ["12,3451"]],
		["212,34515,678", ["212,34515", "678"]],
		["12,345.6 and 1 234 567", ["12,345.6", "1 234 567"]],
		["1\u2009234\u2009567", ["1\u2009234\u2009567"]],
		["2,500 300", ["2,500", "300"]],
		["2023 500", ["2023", "500"]],
		["1.234,5", ["1.234,5"]],
		["1.234.567 and 1.234", ["1.234.567", "1.234"]],
	] as const) {
		test(`#given ${JSON.stringify(text)} #when tokenized #then ${JSON.stringify(expected)}`, () => expect(numbers(text)).toEqual([...expected]))
	}

	test("#given grouped and plain tokens #when normalized #then group separators drop and a decimal comma reads as a point", () => {
		expect(["12,345.6", "1 234 567", "1.234,5", "12,3451", "4.22"].map(plainDecimal)).toEqual(["12345.6", "1234567", "1234.5", "12.3451", "4.22"])
	})

	test("#given a single period group #when normalized #then it is a decimal, as parseNumeral reads it", () => {
		expect(["1.234", "1.234.567"].map(plainDecimal)).toEqual(["1.234", "1234567"])
		expect(parseNumeral("1.234 units")?.value).toBe("1.234")
	})

	test("#given comma grouping #when parseNumeral reads it #then only a well-formed group is one value", () => {
		expect(new RegExp(`^${groupedNumberSource([","])}$`).test("1,237")).toBe(true)
		expect(parseNumeral("1,237 units")?.value).toBe("1237")
		expect(parseNumeral("12,3451 units")?.value).not.toBe("123451")
	})
})
