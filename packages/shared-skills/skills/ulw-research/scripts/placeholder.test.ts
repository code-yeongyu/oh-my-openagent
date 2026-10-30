import { describe, expect, test } from "bun:test"

import { findPlaceholders, lead, parsePlaceholder, subSpan } from "./placeholder.mjs"

const QUOTE = "we estimate completion no earlier than 2027"

describe("parsePlaceholder", () => {
	test("value pointers: full, value, unit, q", () => {
		expect(parsePlaceholder("{{F12:span_len}}")).toEqual({ id: "F12", kind: "F", label: "span_len", mode: "full" })
		expect(parsePlaceholder("{{F12:span_len:value}}")).toEqual({ id: "F12", kind: "F", label: "span_len", mode: "value" })
		expect(parsePlaceholder("{{F12:span_len:unit}}")).toEqual({ id: "F12", kind: "F", label: "span_len", mode: "unit" })
		expect(parsePlaceholder("{{F12:span_len:q}}")).toEqual({ id: "F12", kind: "F", label: "span_len", mode: "q" })
	})

	test("quote pointers: full, lead, from/to with JSON anchors", () => {
		expect(parsePlaceholder("{{Q7:completion}}")).toEqual({ id: "Q7", kind: "Q", label: "completion", mode: "full", selector: "full" })
		expect(parsePlaceholder("{{Q7:completion:lead=18}}")).toEqual({ id: "Q7", kind: "Q", label: "completion", mode: "lead", lead: 18, selector: "lead=18" })
		expect(parsePlaceholder('{{Q7:completion:from="no earlier":to="2027"}}')).toEqual({
			id: "Q7",
			kind: "Q",
			label: "completion",
			mode: "span",
			from: "no earlier",
			to: "2027",
			selector: "from=no earlier;to=2027",
		})
	})

	test("an anchor may contain a colon or an escaped quote", () => {
		const parsed = parsePlaceholder('{{Q7:c:from="a:b":to="say \\"x\\""}}')
		expect(parsed).toMatchObject({ mode: "span", from: "a:b", to: 'say "x"' })
	})

	test("malformed pointers carry an error and no id guess", () => {
		for (const token of ["{{F12}}", "{{X1:a}}", "{{F12:a:lead=3}}", "{{Q7:a:value}}", "{{Q7:a:lead=0}}", '{{Q7:a:from="":to="b"}}', '{{Q7:a:from="a"}}', "{{F12:a:b:c}}"]) {
			expect(parsePlaceholder(token)).toHaveProperty("error")
		}
	})
})

describe("findPlaceholders", () => {
	test("returns every token with offsets that slice back to it", () => {
		const text = 'Span {{F12:span_len}} and {{Q7:completion:from="a}}b":to="c"}} end'
		const found = findPlaceholders(text)
		expect(found.map((item) => item.token)).toEqual(["{{F12:span_len}}", '{{Q7:completion:from="a}}b":to="c"}}'])
		for (const item of found) expect(text.slice(item.start, item.end)).toBe(item.token)
		expect(found[1].parsed).toMatchObject({ from: "a}}b", to: "c" })
	})

	test("an unterminated pointer is reported, not skipped", () => {
		const found = findPlaceholders("a {{F12:span_len\nb")
		expect(found).toHaveLength(1)
		expect(found[0].parsed).toHaveProperty("error")
	})
})

describe("subSpan", () => {
	test("inclusive sub-span with an ellipsis only at cut ends", () => {
		expect(subSpan(QUOTE, "no earlier", "2027")).toEqual({ text: "\u2026no earlier than 2027", start: 23, end: 43 })
		expect(subSpan(QUOTE, "we", "completion")).toEqual({ text: "we estimate completion\u2026", start: 0, end: 22 })
		expect(subSpan(QUOTE, "estimate", "earlier").text).toBe("\u2026estimate completion no earlier\u2026")
	})

	test("an anchor that is missing, repeated, or reversed is null", () => {
		expect(subSpan(QUOTE, "missing", "2027")).toBeNull()
		expect(subSpan(QUOTE, "ti", "2027")).toBeNull()
		expect(subSpan(QUOTE, "2027", "estimate")).toBeNull()
	})
})

describe("lead", () => {
	test("first n words plus an ellipsis, never cutting a word", () => {
		expect(lead(QUOTE, 3)).toEqual({ text: "we estimate completion\u2026", start: 0, end: 22 })
		expect(lead(QUOTE, 7)).toEqual({ text: QUOTE, start: 0, end: QUOTE.length })
		expect(lead(QUOTE, 40)).toEqual({ text: QUOTE, start: 0, end: QUOTE.length })
	})
})
