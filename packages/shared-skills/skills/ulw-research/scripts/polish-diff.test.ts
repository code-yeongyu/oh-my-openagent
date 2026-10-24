import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderValueHtml } from "./placeholder.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import * as polishDiff from "./polish-diff.mjs"
import * as polishProject from "./polish-project.mjs"
import * as polishRules from "./polish-rules.mjs"

const { diffPolish } = polishDiff

const SPAN = { fact_id: "F2", kind: "measured", quote: "The bridge has a main span of 320 m.", raw: "320 m", value: "320", unit: "m", qualifier: null }
const MAKER = { fact_id: "F5", kind: "measured", quote: "In May, Samsung Electronics shipped 12 units.", raw: "12 units", value: "12", unit: "units", qualifier: null }
const SALES = { fact_id: "F6", kind: "measured", quote: "Sales were approximately 7 units.", raw: "7 units", value: "7", unit: "units", qualifier: null }
const LEDGER = { schemaVersion: 1, rows: [SPAN, MAKER, SALES], events: [] }
const span = renderValueHtml(SPAN, SPAN.raw)
const doc = (body: string) => `<html><body>\n${body}\n</body></html>`
const codes = (list: { code: string }[]) => list.map((item) => item.code)

describe("diffPolish: protected content", () => {
	test("identical documents have no defects", () => {
		const html = doc(`<p>The span was about ${span} [S1].</p><table><tr><td>A</td></tr></table>`)
		expect(diffPolish(html, html, LEDGER)).toEqual([])
	})

	test("one numeral that differs inside a fact span is polish_diff_fail", () => {
		const before = doc(`<p>The span is ${span} [S1].</p>`)
		const after = doc(`<p>The span is ${span.replace(">320 m<", ">321 m<")} [S1].</p>`)
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_diff_fail"])
	})

	test("one numeral that differs outside fact spans is polish_diff_fail", () => {
		const before = doc("<p>Throughput grew 3.5 times in the pilot [S1].</p>")
		const after = doc("<p>Throughput grew 35 times in the pilot [S1].</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_diff_fail"])
	})

	test("a dropped table row is polish_diff_fail", () => {
		const before = doc("<table><tr><td>A</td></tr><tr><td>B</td></tr></table>")
		const after = doc("<table><tr><td>A</td></tr></table>")
		expect(codes(diffPolish(before, after, LEDGER))).toContain("polish_diff_fail")
	})

	test("a changed ticker or six-digit exchange code is polish_diff_fail", () => {
		expect(codes(diffPolish(doc("<p>AAPL [S1].</p>"), doc("<p>MSFT [S1].</p>"), LEDGER))).toEqual(["polish_diff_fail"])
		expect(codes(diffPolish(doc("<p>Code 005930 [S1].</p>"), doc("<p>Code 000660 [S1].</p>"), LEDGER))).toEqual(["polish_diff_fail"])
	})
})

describe("diffPolish: hedges, churn, links and names", () => {
	test("two hedges removed from claim-only text is polish_hedging_decreased", () => {
		const before = doc("<p>Results may improve and are provisional. The study covered the pilot only.</p>")
		const after = doc("<p>Results improve and are final. The study covered the pilot only.</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_hedging_decreased"])
	})

	test("deleting a writer-added hedge the source lacks is not a hedge loss", () => {
		const before = doc(`<p>The span was about ${span} [S1].</p>`)
		const after = doc(`<p>The span was ${span} [S1].</p>`)
		expect(diffPolish(before, after, LEDGER)).toEqual([])
	})

	test("a 60 percent rewrite is polish_text_churn and 50 percent is not", () => {
		expect(codes(diffPolish(doc("<p>abcdefghij</p>"), doc("<p>klmnopghij</p>"), LEDGER))).toEqual(["polish_text_churn"])
		expect(diffPolish(doc("<p>abcdefghij</p>"), doc("<p>klmnofghij</p>"), LEDGER)).toEqual([])
	})

	test("a changed link target or an internal link that stops resolving is polish_link_changed", () => {
		const link = (href: string) => doc(`<p id="top"><a href="${href}">Reference</a> [S1].</p>`)
		expect(codes(diffPolish(link("https://example.invalid/a"), link("https://example.invalid/b"), LEDGER))).toEqual(["polish_diff_fail", "polish_link_changed"])
		const before = doc('<h2 id="m">Method</h2><p><a href="#m">Method</a> [S1].</p>')
		const after = doc('<h2 id="method">Method</h2><p><a href="#m">Method</a> [S1].</p>')
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_diff_fail", "polish_link_changed"])
	})

	test("a ledger-quote name present before and absent after is polish_name_changed", () => {
		const before = doc("<p>Samsung Electronics shipped more units in the quarter [S1].</p>")
		const after = doc("<p>The company shipped more units in the quarter [S1].</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_name_changed"])
	})

	test("every defect carries its fixed severity", () => {
		const before = doc("<p>Results may improve and are provisional [S1].</p><table><tr><td>A</td></tr><tr><td>B</td></tr></table>")
		const after = doc("<p>Results improve and are final [S1].</p><table><tr><td>A</td></tr></table>")
		const defects = diffPolish(before, after, LEDGER)
		expect(codes(defects)).toEqual(["polish_diff_fail", "polish_hedging_decreased"])
		for (const defect of defects) expect(defect.severity).toBe(DEFECT_CODES[defect.code].severity)
	})
})

describe("diffPolish: severities come from DEFECT_CODES (review #11152 round 1)", () => {
	test("no polish module exports a local severity table", () => {
		for (const mod of [polishDiff, polishRules]) expect(Object.keys(mod).filter((name) => /severity/i.test(name))).toEqual([])
		for (const file of ["polish-diff.mjs", "polish-rules.mjs", "polish-apply.mjs", "polish-project.mjs"]) {
			const source = readFileSync(join(import.meta.dir, file), "utf8")
			expect(source.match(/["'](?:blocker|major|minor)["']/g) ?? [], file).toEqual([])
		}
	})

	test("every polish code resolves through DEFECT_CODES and each defect carries that severity", () => {
		for (const code of polishRules.POLISH_CODES) expect(Object.hasOwn(DEFECT_CODES, code), code).toBe(true)
		const before = doc('<p>Samsung Electronics may improve [S1].</p><p><a href="/a">x</a> abcdefghij</p><table><tr><td>A</td></tr><tr><td>B</td></tr></table>')
		const after = doc('<p>The firm improves [S1].</p><p><a href="/b">x</a> klmnopqrstuvwxyz</p><table><tr><td>A</td></tr></table>')
		const defects = diffPolish(before, after, LEDGER)
		expect(codes(defects)).toEqual([...polishRules.POLISH_CODES])
		for (const defect of defects) expect(defect.severity, defect.code).toBe(DEFECT_CODES[defect.code].severity)
	})
})

describe("diffPolish: rendered visibility and hedge comparison (review #11152 round 1)", () => {
	test.each([
		["a hidden attribute", `<span hidden>${span}</span>`],
		["display:none", `<span style="display:none">${span}</span>`],
		["a template", `<template>${span}</template>`],
	])("a fact span hidden by %s is polish_diff_fail", (_label, hidden) => {
		expect(codes(diffPolish(doc(`<p>The span is ${span} [S1].</p>`), doc(`<p>The span is ${hidden} [S1].</p>`), LEDGER))).toContain("polish_diff_fail")
	})

	test("wrapping a hedge changes markup and is blocked before full fidelity verification", () => {
		const after = doc("<p>Results <span hidden>may</span> improve [S1].</p>")
		expect(codes(diffPolish(doc("<p>Results may improve [S1].</p>"), after, LEDGER))).toEqual(["polish_diff_fail"])
	})

	test("a ledger hedge the sentence never held is not a decrease", () => {
		const sales = renderValueHtml(SALES, SALES.raw)
		const before = doc(`<p>The share of revenue was ${sales} [S1].</p>`)
		const after = doc(`<p>The share in revenue was ${sales} [S1].</p>`)
		expect(diffPolish(before, after, LEDGER)).toEqual([])
	})

	test("single-quoted and unquoted href changes are polish_link_changed", () => {
		expect(codes(diffPolish(doc("<p><a href='/a'>x</a></p>"), doc("<p><a href='/b'>x</a></p>"), LEDGER))).toEqual(["polish_diff_fail", "polish_link_changed"])
		expect(codes(diffPolish(doc("<p><a href=/a>x</a></p>"), doc("<p><a href=/b>x</a></p>"), LEDGER))).toEqual(["polish_diff_fail", "polish_link_changed"])
	})

	test("the same input gives byte-identical output", () => {
		const before = doc("<p>Results may improve and are provisional [S1].</p>")
		const after = doc("<p>Results improve and are final [S1].</p>")
		expect(JSON.stringify(diffPolish(before, after, LEDGER))).toBe(JSON.stringify(diffPolish(before, after, LEDGER)))
	})
})

describe("claim ids and fact-span scanning (review #11152 round 2, L1 and L2)", () => {
	test("L1: a changed data-claim id is a blocking polish_diff_fail, as apply treats it, not a minor link change", () => {
		const defects = diffPolish(doc('<p data-claim="C1">Results improve [S1].</p>'), doc('<p data-claim="C2">Results improve [S1].</p>'), LEDGER)
		expect(codes(defects)).toEqual(["polish_diff_fail"])
		expect(defects[0].severity).toBe(DEFECT_CODES.polish_diff_fail.severity)
		expect(defects[0].message).toContain("markup changed")
	})

	test("L2: a nested same-name element and a quoted '>' stay inside one fact span", () => {
		const nested = '<p><q data-fact="F1">a <q>b</q> c</q> d</p>'
		expect(polishProject.factSpans(nested).map((s: { html: string }) => s.html)).toEqual(['<q data-fact="F1">a <q>b</q> c</q>'])
		const quoted = '<p><data title="a>b" data-fact="F2">320 m</data> d</p>'
		expect(polishProject.factSpans(quoted).map((s: { id: string; html: string }) => [s.id, s.html])).toEqual([["F2", '<data title="a>b" data-fact="F2">320 m</data>']])
	})
})

describe("polish policies have one owner (duplication sweep)", () => {
	test("the named policies are exported once, from their owners", () => {
		expect(polishRules.POLISH_CHURN_LIMIT).toBe(0.5)
		expect("Samsung Electronics".match(polishRules.POLISH_NAME)).toEqual(["Samsung", "Electronics"])
		expect(polishDiff.TICKER).toBe(polishRules.TICKER)
		expect(polishProject.POLISH_LINK_ATTRIBUTES).toEqual(["href"])
		expect("v1.25 and 3,000".match(polishProject.POLISH_DIGITS)).toEqual(["1.25", "3,000"])
	})
})
