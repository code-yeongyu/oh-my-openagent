import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { locateFind, locateMatch, locatePageLine, locateTable } from "./fact-locate.mjs"
import { snapshotFromHtml } from "./source-snapshot.mjs"

const FIXTURES = join(import.meta.dir, "tests", "fixtures", "fidelity", "sources")
const S4_HTML = readFileSync(join(FIXTURES, "S4.html"), "utf8")
const S4_TEXT = snapshotFromHtml(S4_HTML)
const S9_TEXT = readFileSync(join(FIXTURES, "S9.txt"), "utf8")
const MAX = "\uCD5C\uB300"

type Located = {
	value: string | null
	unit: string | null
	raw: string
	quote: string
	value_span: [number, number] | null
	sentence_id: string
	qualifier: string | null
	fuzzy?: boolean
	locator: { artifact: string; char_start: number; char_end: number; page?: number; line: number; table?: string; row_label?: string; col_label?: string }
}

function expectAnchored(text: string, result: Located): void {
	expect(text.slice(result.locator.char_start, result.locator.char_end)).toBe(result.quote)
	if (result.value_span) expect(result.quote.slice(result.value_span[0], result.value_span[1])).toBe(result.raw)
}

describe("locateFind", () => {
	test("#given an anchor followed by a quantity #when located #then the value, unit, sentence and locator bind to the snapshot", () => {
		const result = locateFind(S4_TEXT, { find: "Span length", sourceId: "S4" })
		expect(result).toMatchObject({ value: "320", unit: "m", raw: "320 m", quote: "Span length: 320 m", qualifier: null })
		expect(result.sentence_id).toMatch(/^S4:s\d+$/)
		expect(result.locator.artifact).toBe("S4/text.txt")
		expectAnchored(S4_TEXT, result)
	})

	test("#given an expected unit that differs #when located #then unit_expected_mismatch", () => {
		expect(locateFind(S4_TEXT, { find: "Span length", unitExpected: "mm", sourceId: "S4" })).toMatchObject({ error: "unit_expected_mismatch" })
		expect(locateFind(S4_TEXT, { find: "Span length", unitExpected: "meters", sourceId: "S4" })).toMatchObject({ value: "320" })
	})

	test("#given a Korean anchor before a scaled amount #when located #then the first numeral after the anchor is the value and the anchor is the qualifier", () => {
		const result = locateFind(S9_TEXT, { find: MAX, sourceId: "S9" })
		expect(result).toMatchObject({ value: "4200000000000", unit: "KRW", qualifier: MAX, sentence_id: "S9:s1" })
		expectAnchored(S9_TEXT, result)
	})

	test("#given an English bounding phrase before the value #when located #then it is the qualifier", () => {
		const text = "The contract costs up to 40 million USD in total."
		expect(locateFind(text, { find: "costs", sourceId: "S3" })).toMatchObject({ value: "40000000", unit: "USD", qualifier: "up to" })
	})

	test("#given an anchor that occurs twice #when located #then fact_ambiguous lists both candidates", () => {
		const result = locateFind(S4_TEXT, { find: "span cost", sourceId: "S4" })
		expect(result.error).toBe("fact_ambiguous")
		expect(result.candidates).toHaveLength(2)
	})

	test("#given a missing anchor, or no numeral within the anchor's sentence #when located #then fact_not_located", () => {
		expect(locateFind(S4_TEXT, { find: "nonexistent", sourceId: "S4" })).toMatchObject({ error: "fact_not_located", candidates: [] })
		expect(locateFind("Total reached.\nIt was 12 m.", { find: "Total", sourceId: "S1" })).toMatchObject({ error: "fact_not_located" })
		expect(locateFind(`Delta ${"x".repeat(90)} 7 m`, { find: "Delta", sourceId: "S1" })).toMatchObject({ error: "fact_not_located" })
	})
})

describe("locateTable", () => {
	test("#given a table found by a header label #when the row and column labels match #then the cell value binds to its text.txt line", () => {
		const result = locateTable(S4_HTML, { table: "Length", row: "Span", col: "Length", sourceId: "S4" })
		expect(result).toMatchObject({ value: "320", unit: "m", quote: "320 m", locator: { table: "Length", row_label: "Span", col_label: "Length" } })
		expect(result.sentence_id).toMatch(/^S4:s\d+$/)
		expectAnchored(S4_TEXT, result)
		expect(locateTable(S4_HTML, { table: "dimensions", row: "Approach", col: "Length", sourceId: "S4" })).toMatchObject({ value: "85" })
	})

	test("#given an unknown table, row or column, or a duplicated row label #when located #then it fails without guessing", () => {
		expect(locateTable(S4_HTML, { table: "Width", row: "Span", col: "Length", sourceId: "S4" })).toMatchObject({ error: "fact_not_located" })
		expect(locateTable(S4_HTML, { table: "Length", row: "Deck", col: "Length", sourceId: "S4" })).toMatchObject({ error: "fact_not_located" })
		const twice = "<table><tr><th>Item</th><th>Cost</th></tr><tr><td>Span</td><td>3</td></tr><tr><td>Span</td><td>4</td></tr></table>"
		expect(locateTable(twice, { table: "Cost", row: "Span", col: "Cost", sourceId: "S5" })).toMatchObject({ error: "fact_ambiguous" })
	})
})

describe("locatePageLine", () => {
	const text = "Intro line\nRevenue: 15 %\fCost: 3 m\nBetween 1 m and 2 m"

	test("#given a page and line holding one quantity #when located #then it binds with its page and line", () => {
		const result = locatePageLine(text, { page: 1, line: 2, sourceId: "S6" })
		expect(result).toMatchObject({ value: "15", unit: "%", quote: "Revenue: 15 %", locator: { line: 2 } })
		expectAnchored(text, result)
		expect(locatePageLine(text, { page: 2, line: 1, sourceId: "S6" })).toMatchObject({ value: "3", locator: { page: 2, line: 1 } })
	})

	test("#given a line with two quantities or a missing page #when located #then ambiguous or not located", () => {
		expect(locatePageLine(text, { page: 2, line: 2, sourceId: "S6" })).toMatchObject({ error: "fact_ambiguous" })
		expect(locatePageLine(text, { page: 3, line: 1, sourceId: "S6" })).toMatchObject({ error: "fact_not_located" })
	})
})

describe("locateMatch", () => {
	test("#given an exact match #when located #then raw is the snapshot bytes, the quote is the whole sentence, and there is no value span", () => {
		const result = locateMatch(S4_TEXT, { match: "no  earlier than 2027", sourceId: "S4" })
		expect(result).toMatchObject({ raw: "no earlier than 2027", quote: "After the delay, we estimate completion no earlier than 2027.", value_span: null, value: null, fuzzy: false })
		expectAnchored(S4_TEXT, result)
	})

	test("#given a near match at or above 0.95 similarity #when located #then the window returns with fuzzy true; below it, fact_not_located", () => {
		const near = locateMatch(S4_TEXT, { match: "we estimate completion no earlier then 2027", sourceId: "S4" })
		expect(near).toMatchObject({ raw: "we estimate completion no earlier than 2027", fuzzy: true })
		expect(locateMatch(S4_TEXT, { match: "completion is certain by 2026", sourceId: "S4" })).toMatchObject({ error: "fact_not_located" })
	})

	test("#given a phrase that occurs twice #when located #then fact_ambiguous", () => {
		expect(locateMatch(S4_TEXT, { match: "span cost", sourceId: "S4" })).toMatchObject({ error: "fact_ambiguous" })
	})
})
