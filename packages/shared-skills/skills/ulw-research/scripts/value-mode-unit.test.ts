import { describe, expect, onTestFinished, test } from "bun:test"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import { run } from "./report-tools.mjs"
import { FIX, LEDGER, type Row, type VerifyResult, codes, filled, prose } from "./tests/value-mode-support"

describe("value-mode unit binding through fact fill and verify", () => {
	for (const format of ["html", "md"]) {
		test(`#given ${format} value mode followed by meters #when edited to mm #then verify fails unit_mismatch`, async () => {
			const body = format === "html" ? prose("{{F1:span_len:value}}", " meters") : "## Findings\n\nUp to {{F1:span_len:value}} meters [S4]."
			const { verify, edit } = await filled(body, format)
			expect((await verify()).exitCode).toBe(0)
			edit(" meters", " mm")
			const edited = await verify()
			expect(codes(edited)).toContain("unit_mismatch")
			expect(edited.exitCode).toBe(1)
		})
	}

	for (const [pointer, tail] of [
		["{{F1:span_len:value}}", " m in total length"],
		["{{F20:gap_pp:value}}", " \uD37C\uC13C\uD2B8 \uD3EC\uC778\uD2B8\uB85C"],
		["{{F21:rev_eok:value}}", " \uC5B5 \uC6D0\uC73C\uB85C"],
	]) {
		test(`#given ordinary prose ${JSON.stringify(tail)} after ${pointer} #when verified #then it binds the row's own unit, never a squashed join`, async () => {
			const result = await (await filled(prose(pointer, tail))).verify()
			expect(codes(result)).toEqual([])
			expect(result.exitCode).toBe(0)
		})
	}

	for (const [pointer, tail, from, to] of [
		["{{F1:span_len:value}}", "m", "</data>m", "</data>mm"],
		["{{F3:rate_yoy:value}}", "%", "</data>%", "</data>%p"],
		["{{F1:span_len:value}}", " m\uC758", " m\uC758", " mm\uC758"],
		["{{F21:rev_eok:value}}", "\uC5B5 \uC6D0\uC73C\uB85C", "\uC5B5 \uC6D0\uC73C\uB85C", "\uC5B5 \uB2EC\uB7EC\uB85C"],
		["{{F22:staff:value}}", "\uBA85\uC774\uB2E4", "\uBA85\uC774\uB2E4", "\uAC74\uC774\uB2E4"],
		["${{F23:price:value}}", "", "$<data", "\u20AC<data"],
	]) {
		test(`#given the documented form ${pointer}${tail} #when its unit is hand-edited #then unit_mismatch blocks`, async () => {
			const { verify, edit } = await filled(prose(pointer, tail))
			const clean = await verify()
			expect(codes(clean)).toEqual([])
			edit(from, to)
			const edited = await verify()
			expect(codes(edited)).toContain("unit_mismatch")
			expect(edited.exitCode).toBe(1)
		})
	}

	// A longer unit that starts with the row's unit (% -> %p): read whole, spaced or glued, EN and KO (peosenteu pointeu).
	for (const to of ["% \uD3EC\uC778\uD2B8", " \uD37C\uC13C\uD2B8 \uD3EC\uC778\uD2B8", " percent points", " % p", " %p", "%\uD3EC\uC778\uD2B8", "\uD37C\uC13C\uD2B8\uD3EC\uC778\uD2B8"]) {
		test(`#given {{F3:rate_yoy:value}}% #when hand-edited to ${JSON.stringify(to)} #then the longer unit is read and unit_mismatch blocks`, async () => {
			const { verify, edit } = await filled(prose("{{F3:rate_yoy:value}}", "%"))
			expect(codes(await verify())).toEqual([])
			edit("</data>%", `</data>${to}`)
			const edited = await verify()
			expect(codes(edited)).toContain("unit_mismatch")
			expect(edited.exitCode).toBe(1)
		})
	}

	test("#given no following unit #when verified #then unit_unbound is a minor warning", async () => {
		const result = await (await filled(prose("{{F1:span_len:value}}", " long"))).verify()
		expect(result.exitCode).toBe(0)
		expect(result.json.defects).toContainEqual(expect.objectContaining({ code: "unit_unbound", severity: "minor" }))
		expect((result.json as { gatesRun?: string[] }).gatesRun).toContain("unit_unbound")
	})

	test("#given the documented split form :value then :unit #when verified #then the unit element binds", async () => {
		expect(codes(await (await filled(prose("{{F1:span_len:value}} {{F1:span_len:unit}}", ""))).verify())).toEqual([])
	})

	test("#given a converted row in value mode followed by its unit #when verified #then display(value, unit) still verifies", async () => {
		expect(codes(await (await filled(prose("{{F8:span_mm:value}}", " mm"))).verify())).not.toContain("unit_mismatch")
	})

	test("#given the sign already inside a value-mode element (valueParts falling back to the raw text) #when checked #then it is bound", () => {
		const element = (shown: string) => `<h2>Findings</h2><p><data class="fact" value="12" data-fact="F23" data-unit="USD" data-fact-mode="value" data-lineage="MEASURED">${shown}</data> [S4].</p>`
		const found = (shown: string) => (valueChecks(buildContext(parseHtml(element(shown)), {}), LEDGER, null, null) as { code: string }[]).map((d) => d.code)
		expect(found("$12")).not.toContain("unit_unbound")
		expect(found("$12")).not.toContain("unit_mismatch")
	})

	test("#given a dimensionless value #when no unit follows #then no unit warning", async () => {
		expect(codes(await (await filled("<p>{{F2:units_sold:value}} [S4].</p>")).verify())).not.toContain("unit_unbound")
	})
})

describe("value-mode units in tables bind by visual column", () => {
	const table = (head: string, rows: string) => `<h2>Findings</h2><table><thead>${head}</thead><tbody>${rows}</tbody></table>`
	for (const [name, html, code] of [
		["a matching header", table("<tr><th>Span (meters)</th></tr>", "<tr><td>{{F1:span_len:value}}</td></tr>"), null],
		["a wrong header", table("<tr><th>Span (mm)</th></tr>", "<tr><td>{{F1:span_len:value}}</td></tr>"), "unit_mismatch"],
		["a conflicting suffix", table("<tr><th>Span (m)</th></tr>", "<tr><td>{{F1:span_len:value}} mm</td></tr>"), "unit_mismatch"],
		["a header disagreeing with a suffix", table("<tr><th>Span (mm)</th></tr>", "<tr><td>{{F1:span_len:value}} m</td></tr>"), "unit_mismatch"],
		["a unit only in another column", table("<tr><th>Span</th><th>Offset (m)</th></tr>", "<tr><td>{{F1:span_len:value}}</td><td>unknown</td></tr>"), "unit_unbound"],
		["a colspan earlier in the row", table("<tr><th>Bridge</th><th>Deck (km)</th><th>Span (m)</th></tr>", '<tr><td colspan="2">Bridge A</td><td>{{F1:span_len:value}}</td></tr>'), null],
		["a rowspan from above", table("<tr><th>Bridge</th><th>Span (m)</th><th>Deck (km)</th></tr>", '<tr><td rowspan="2">A</td><td>x</td><td>y</td></tr><tr><td>{{F1:span_len:value}}</td><td>{{F24:deck_len:value}}</td></tr>'), "unit_unbound"],
		["a headerless key/value table", "<h2>Findings</h2><table><tr><td>Deck</td><td>{{F24:deck_len}}</td></tr><tr><td>Span</td><td>{{F1:span_len:value}}</td></tr></table>", "unit_unbound"],
		["a key/value table with row headers and a matching suffix", "<h2>Findings</h2><table><tr><th>Deck</th><td>{{F24:deck_len}}</td></tr><tr><th>Span</th><td>{{F1:span_len:value}} m</td></tr></table>", null],
		["a body row header under a matching column header", table("<tr><th>Part</th><th>Length (m)</th></tr>", '<tr><th scope="row">Span</th><td>{{F1:span_len:value}}</td></tr>'), null],
		["a body row header under a wrong column header", table("<tr><th>Part</th><th>Length (mm)</th></tr>", '<tr><th scope="row">Span</th><td>{{F1:span_len:value}}</td></tr>'), "unit_mismatch"],
	] as const) {
		test(`#given ${name} #when verified #then ${code ?? "it binds cleanly"}`, async () => {
			const result = await (await filled(html)).verify()
			if (code === null) expect(codes(result)).toEqual([])
			else expect(codes(result)).toContain(code)
			expect(result.exitCode).toBe(code === "unit_mismatch" ? 1 : 0)
			if (code !== "unit_mismatch") expect(codes(result)).not.toContain("unit_mismatch")
		})
	}
})

// Rows as `fact add --find` writes them: the scale word stays in the value's render ("3,234\uC5B5", "12 million").
const PAGE = "<html><body><p>\uB9E4\uCD9C\uC740 3,234\uC5B5 \uC6D0\uC774\uB2E4.</p><p>Revenue reached 12 million dollars.</p><p>The main span is 320 m long.</p></body></html>"

async function located(pointers: string) {
	const dir = mkdtempSync(join(tmpdir(), "value-mode-find-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	copyFileSync(join(FIX, "fidelity-brief-locked.md"), join(dir, "brief.md"))
	writeFileSync(join(dir, "page.html"), PAGE)
	expect((await run(["source", "snapshot", "--id", "S1", "--html", join(dir, "page.html"), "--session-dir", dir])).exitCode).toBe(0)
	const rows: Row[] = []
	for (const [find, label] of [["\uB9E4\uCD9C\uC740", "won"], ["Revenue reached", "rev"], ["main span is", "sp"]]) {
		const added = (await run(["fact", "add", "--source", "S1", "--find", find, "--label", label, "--session-dir", dir, "--json"])) as { exitCode: number; json: { data: { row: Row } } }
		expect(added.exitCode).toBe(0)
		rows.push(added.json.data.row)
	}
	writeFileSync(join(dir, "report.src.html"), `<h2>Findings</h2><p>The source states ${pointers} [S1].</p>`)
	expect((await run(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), "--session-dir", dir])).exitCode).toBe(0)
	const verify = async () => (await run(["fact", "verify", join(dir, "report.html"), "--session-dir", dir])) as VerifyResult
	const edit = (from: string, to: string) => writeFileSync(join(dir, "report.html"), readFileSync(join(dir, "report.html"), "utf8").replace(from, to))
	return { rows, verify, edit }
}

describe("value-mode facts whose render carries a scale word", () => {
	test("#given rows from fact add --find #when located #then the scale is folded into an unscaled unit", async () => {
		const { rows } = await located("{{F1:won}}")
		expect(rows.map((row) => [row.value, row.unit])).toEqual([["323400000000", "KRW"], ["12000000", "USD"], ["320", "m"]])
	})

	for (const pointers of ["{{F1:won:value}} \uC6D0", "{{F1:won:value}}{{F1:won:unit}}", "{{F2:rev:value}} dollars", "{{F2:rev:value}} {{F2:rev:unit}}"]) {
		test(`#given ${JSON.stringify(pointers)} right after fill #when verified #then the scale word is part of the value, not a unit`, async () => {
			const result = await (await located(pointers)).verify()
			expect(codes(result)).toEqual([])
			expect(result.exitCode).toBe(0)
		})
	}

	for (const [pointers, from, to] of [["{{F3:sp:value}}m", "</data>m", "</data>mm"], ["{{F1:won:value}} \uC6D0", "</data> \uC6D0", "</data> \uB2EC\uB7EC"]]) {
		test(`#given ${JSON.stringify(pointers)} #when the unit outside the element is hand-edited #then unit_mismatch still blocks`, async () => {
			const { verify, edit } = await located(pointers)
			expect(codes(await verify())).toEqual([])
			edit(from, to)
			const edited = await verify()
			expect(codes(edited)).toContain("unit_mismatch")
			expect(edited.exitCode).toBe(1)
		})
	}
})
