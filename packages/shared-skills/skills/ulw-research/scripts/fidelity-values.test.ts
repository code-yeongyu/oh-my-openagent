import { describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { exportRows, valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"
import { similarity } from "./text-similarity.mjs"

type Defect = { code: string; severity: string; selector: string; line: number; message: string; hint: string }
type Row = Record<string, unknown> & { fact_id: string }
type Ledger = { schemaVersion: number; rows: Row[]; events: unknown[] }
type Options = { ledger?: Ledger; fillMap?: unknown[] | null; sourcesDir?: string | null; baseDir?: string; recompute?: (ledger: Ledger, row: Row) => { ok: boolean }; asOf?: string }

const FIX = join(import.meta.dir, "tests", "fixtures", "fidelity")
const SOURCES = join(FIX, "sources")
const LEDGER: Ledger = JSON.parse(readFileSync(join(FIX, "ledger-verify.json"), "utf8"))
const FULL = "we estimate completion no earlier than 2027"

function ledgerWith(id: string, patch: Record<string, unknown>): Ledger {
	const copy = structuredClone(LEDGER)
	copy.rows = copy.rows.map((row) => (row.fact_id === id ? { ...row, ...patch } : row))
	return copy
}

function run(body: string, options: Options = {}): Defect[] {
	const html = /<h2/.test(body) ? body : `<h2>Findings</h2>\n${body}`
	const ctx = buildContext(parseHtml(html), { baseDir: options.baseDir ?? FIX })
	const sourcesDir = options.sourcesDir === undefined ? SOURCES : options.sourcesDir
	return valueChecks(ctx, options.ledger ?? LEDGER, options.fillMap ?? null, sourcesDir, options) as Defect[]
}

const codes = (defects: Defect[]) => defects.map((defect) => defect.code)
const fact = (id: string, text: string, unit = "") => `<data class="fact" data-fact="${id}"${unit ? ` data-unit="${unit}"` : ""}>${text}</data>`
const quote = (sel: string, text: string) => `<p>They wrote <q data-fact="Q1" data-quote-sel="${sel}">${text}</q> [S4].</p>`

const TICKS = (labels: string[]) => `<g class="ticks" data-tick-step="10" data-tick-min="0" data-tick-max="30">${labels.map((label) => `<text>${label}</text>`).join("")}</g>`
const chart = (attrs: string, ticks: string[], labels: string[]) =>
	`<figure ${attrs}><svg viewBox="0 0 200 100">${TICKS(ticks)}${labels.map((label) => `<text>${label}</text>`).join("")}</svg><figcaption>Share by segment [S4].</figcaption></figure>`

describe("untraceable numbers", () => {
	test("#given a typed 12% with no ledger row #when checked #then untraceable_number", () => {
		expect(codes(run("<p>Revenue grew 12% [S4].</p>"))).toEqual(["untraceable_number"])
	})

	test("#given a table cell numeral without data-fact #when checked #then untraceable_number covers table cells", () => {
		const defects = run("<table><tr><th>Metric</th><th>Value</th></tr><tr><td>Span</td><td>320 m</td></tr></table>")
		expect(codes(defects)).toEqual(["untraceable_number"])
	})

	test("#given an appendix sentence with a citation but no row #when checked #then the citation does not exempt it", () => {
		expect(codes(run("<h2>Appendix</h2><p>Revenue grew 12% [S4].</p>"))).toEqual(["untraceable_number"])
	})

	test("#given the same sentence under Sources #when checked #then it is out of scope", () => {
		expect(run("<h2>Sources</h2><p>Revenue grew 12% [S4].</p>")).toEqual([])
	})

	test("#given a date in prose #when checked #then dates are in scope", () => {
		expect(codes(run("<p>The board met on 2026-03-04 [S4].</p>"))).toEqual(["untraceable_number"])
	})

	test("#given heading numbering, figure references, versions and times #when checked #then structural numerals are exempt", () => {
		const body = "<h2>2. Findings</h2><p>See Figure 3 and table 2 on page 7; v1.2.3 shipped at 10:30 [S4].</p>"
		expect(run(body)).toEqual([])
	})

	test("#given the good report's facts #when checked #then numerals inside data-fact and Q elements are traced", () => {
		const body = `<p>The span is ${fact("F1", "up to 320 m", "m")} long [S4].</p>${quote("full", FULL)}`
		expect(run(body)).toEqual([])
	})
})

describe("protected values", () => {
	test("#given '320 mm' on a 320 m row #when checked #then unit_mismatch", () => {
		expect(codes(run(`<p>Span ${fact("F1", "320 mm", "m")} [S4].</p>`))).toEqual(["unit_mismatch"])
	})

	test("#given '1,273' on a 1,237 row #when checked #then value_mismatch", () => {
		expect(codes(run(`<p>Units ${fact("F2", "1,273")} [S4].</p>`))).toEqual(["value_mismatch"])
	})

	test("#given the converted row's render #when checked #then it verifies clean", () => {
		expect(run(`<p>Span ${fact("F8", "320,000 mm (320 m)", "mm")} [S4].</p>`)).toEqual([])
	})

	test("#given a data-fact id with no ledger row #when checked #then unresolved_placeholder", () => {
		expect(codes(run(`<p>Span ${fact("F99", "5 m")} [S4].</p>`))).toEqual(["unresolved_placeholder"])
	})

	test("#given a leftover placeholder #when checked #then unresolved_placeholder", () => {
		expect(codes(run("<p>Next year brings {{F9:growth}} more traffic [S4].</p>"))).toEqual(["unresolved_placeholder"])
	})
})

describe("quotes", () => {
	test("#given a digit changed inside a rendered quote #when checked #then quote_not_verbatim with no fuzzy downgrade", () => {
		const altered = FULL.replace("2027", "2028")
		expect(similarity(altered, FULL)).toBeGreaterThan(0.95)
		expect(codes(run(quote("full", altered)))).toEqual(["quote_not_verbatim"])
	})

	const SELECTIONS: [string, string, string][] = [
		["full", FULL, FULL.replace("estimate", "expect")],
		["lead=4", "we estimate completion no\u2026", "we estimate completion soon\u2026"],
		["from=no earlier;to=2027", "\u2026no earlier than 2027", "\u2026no later than 2027"],
	]
	for (const [sel, rendered, altered] of SELECTIONS) {
		test(`#given fill's ${sel} rendering #when verified #then clean, and one altered word is quote_not_verbatim`, () => {
			expect(run(quote(sel, rendered))).toEqual([])
			expect(codes(run(quote(sel, altered)))).toEqual(["quote_not_verbatim"])
		})
	}

	test("#given a quote row flagged fuzzy at registration #when cited #then quote_fuzzy_match describes the source", () => {
		expect(codes(run(quote("full", FULL), { ledger: ledgerWith("Q1", { fuzzy: true }) }))).toEqual(["quote_fuzzy_match"])
	})

	test("#given a quote revision that differs from the brief's as-of anchor #when checked #then quote_stale_version", () => {
		const ledger = ledgerWith("Q1", { revision: "v3.1" })
		expect(codes(run(quote("full", FULL), { ledger, asOf: "v3.2 (release notes)" }))).toEqual(["quote_stale_version"])
		expect(run(quote("full", FULL), { ledger, asOf: "v3.1" })).toEqual([])
		expect(run(quote("full", FULL), { ledger, asOf: "latest at run start, 2026-10-23" })).toEqual([])
	})
})

describe("quote binding", () => {
	test("#given a <q> with no Q row #when checked #then quote_unbound (rule a)", () => {
		expect(codes(run("<p><q>Completion is guaranteed.</q> [S4]</p>"))).toEqual(["quote_unbound"])
	})

	test("#given a quoted run of three words with a citation and no fillMap Q entry #when checked #then quote_unbound (rule c)", () => {
		expect(codes(run('<p>"Completion is guaranteed." [S4]</p>', { fillMap: [] }))).toEqual(["quote_unbound"])
	})

	test("#given the same quote covered by a fillMap Q entry #when checked #then clean", () => {
		const ledger = structuredClone(LEDGER)
		ledger.rows.push({ ...ledger.rows.find((row) => row.fact_id === "Q1"), fact_id: "Q2", label: "guarantee", quote: "Completion is guaranteed.", raw: "Completion is guaranteed." } as Row)
		const fillMap = [{ token: "{{Q2:guarantee}}", fact_id: "Q2", start: 0, end: 27, rendered: '"Completion is guaranteed."', selector: "full" }]
		expect(run('<p>"Completion is guaranteed." [S4]</p>', { ledger, fillMap })).toEqual([])
	})

	test("#given a four-word quoted run with no citation #when checked #then quote_unbound (rule b)", () => {
		expect(codes(run('<p>The plan says "no earlier than 2027" for now.</p>'))).toContain("quote_unbound")
	})

	test("#given a single quoted UI label without a citation #when checked #then not a quotation", () => {
		expect(run('<p>Press the "Save" button.</p>')).toEqual([])
	})

	test("#given a single quoted term followed by a citation #when checked #then quote_unbound (rule c)", () => {
		expect(codes(run('<p>Press the "Save" button [S4].</p>'))).toEqual(["quote_unbound"])
	})
})

describe("fill maps (Markdown)", () => {
	test("#given a fillMap F entry whose text was edited after fill #when checked #then value_mismatch", () => {
		const fillMap = [{ token: "{{F2:units_sold}}", fact_id: "F2", start: 0, end: 5, rendered: "1,273" }]
		expect(codes(run("<p>Units sold reached 1,273 [S4].</p>", { fillMap }))).toEqual(["value_mismatch"])
	})

	test("#given a fillMap F entry that matches its row and the text #when checked #then the numeral is traced", () => {
		const fillMap = [{ token: "{{F2:units_sold}}", fact_id: "F2", start: 0, end: 5, rendered: "1,237" }]
		expect(run("<p>Units sold reached 1,237 [S4].</p>", { fillMap })).toEqual([])
	})
})

describe("derivations, joins, snapshots", () => {
	test("#given recompute reports a tampered derived row #when checked #then value_mismatch", () => {
		const body = `<p>Span ${fact("F8", "320,000 mm (320 m)", "mm")} [S4].</p>`
		expect(codes(run(body, { recompute: () => ({ ok: false }) }))).toEqual(["value_mismatch"])
		expect(run(body, { recompute: () => ({ ok: true }) })).toEqual([])
	})

	test("#given a derived row whose operand was observed outside its snapshot window #when checked #then snapshot_mismatch", () => {
		const ledger = ledgerWith("F8", { snapshot_window: { dataset_id: "d1", start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" } })
		expect(codes(run(`<p>Span ${fact("F8", "320,000 mm (320 m)", "mm")} [S4].</p>`, { ledger }))).toEqual(["snapshot_mismatch"])
	})

	test("#given a table row joining two observations #when checked #then join_integrity_fail", () => {
		const table = `<table><tr><td>${fact("F1", "320 m", "m")}</td><td>${fact("F3", "12%", "%")}</td></tr></table>`
		expect(codes(run(table))).toEqual(["join_integrity_fail"])
		expect(run(table.replace("<tr>", '<tr data-row-kind="comparison">'))).toEqual([])
	})

	test("#given a snapshot whose text changed after pinning #when checked #then snapshot_hash_mismatch", () => {
		const dir = mkdtempSync(join(tmpdir(), "fidelity-values-"))
		try {
			cpSync(SOURCES, dir, { recursive: true })
			writeFileSync(join(dir, "S4", "text.txt"), "edited\n")
			expect(codes(run(`<p>Span ${fact("F1", "up to 320 m", "m")} [S4].</p>`, { sourcesDir: dir }))).toEqual(["snapshot_hash_mismatch"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

})

describe("verification claims are structural (data-claim-kind)", () => {
	const verified = (id: string, text: string, unit = "") => fact(id, text, unit).replace("<data ", '<data data-claim-kind="verified" ')
	const severities = (defects: Defect[]) => defects.map((defect) => `${defect.code}:${defect.severity}`)

	test("#given a claim MARKED verified citing a measured page row #when checked #then unsupported_verification major", () => {
		expect(severities(run(`<p>The span is ${verified("F1", "up to 320 m", "m")} [S4].</p>`))).toEqual(["unsupported_verification:major"])
	})

	test("#given a claim MARKED verified citing a recorded command row #when checked #then no defect", () => {
		expect(run(`<p>The suite ran with ${verified("F7", "42 passed")} [S5].</p>`)).toEqual([])
	})

	test("#given an UNMARKED pretend-verification sentence #when checked #then verification_claim_unmarked as a minor warning and no major", () => {
		expect(severities(run("<p>We verified the span by running the measurement script [S4].</p>"))).toEqual(["verification_claim_unmarked:minor"])
	})

	const quiet = [
		`<p>The tests showed a ${fact("F3", "12%", "%")} drop [S4].</p>`,
		`<p>The bridge, which ran across the river, spans ${fact("F1", "up to 320 m", "m")} [S4].</p>`,
		`<p>The span is ${fact("F1", "up to 320 m", "m")}, as confirmed with the annual inspection report [S4].</p>`,
		`<p>Clinical tests confirmed the span of ${fact("F1", "up to 320 m", "m")} [S4].</p>`,
		`<p>확인된 길이는 ${fact("F1", "최대 320 m", "m")} [S4].</p>`,
	]
	for (const body of quiet) {
		test(`#given findings prose ${JSON.stringify(body.replace(/<[^>]+>/g, ""))} #when checked #then no warning and no major`, () => expect(run(body)).toEqual([]))
	}

	test("#given an UNMARKED Korean run-and-check sentence #when checked #then verification_claim_unmarked minor only", () => {
		expect(severities(run(`<p>우리가 실행해 확인한 길이는 ${fact("F1", "최대 320 m", "m")} [S4].</p>`))).toEqual(["verification_claim_unmarked:minor"])
	})

	test("#given the same run-and-check sentence MARKED verified on a command row #when checked #then no warning", () => {
		expect(run(`<p>We ran the suite by running the test script, and it reported ${verified("F7", "42 passed")} [S5].</p>`)).toEqual([])
	})
})

describe("charts", () => {
	const SRC = 'data-chart-source="assets/share.csv"'

	test("#given a chart with an on-grid ticks group and a data label matching the CSV #when checked #then clean", () => {
		expect(run(chart(SRC, ["0", "10", "20", "30"], ["12%"]))).toEqual([])
	})

	test("#given an off-grid tick #when checked #then chart_value_untraceable", () => {
		expect(codes(run(chart(SRC, ["0", "10", "25", "30"], ["12%"])))).toEqual(["chart_value_untraceable"])
	})

	test("#given a data label with no CSV plot value #when checked #then chart_value_untraceable", () => {
		expect(codes(run(chart(SRC, ["0", "10", "20", "30"], ["13%"])))).toEqual(["chart_value_untraceable"])
	})

	test("#given a chart figure without data-chart-source #when checked #then chart_value_untraceable", () => {
		expect(codes(run(chart("", ["0", "10", "20", "30"], ["12%"])))).toEqual(["chart_value_untraceable"])
	})

	test("#given a CSV whose row differs from the ledger export #when checked #then chart_value_untraceable", () => {
		const dir = mkdtempSync(join(tmpdir(), "fidelity-chart-"))
		try {
			writeFileSync(join(dir, "share.csv"), "fact_id,plot_value,unit\nF5,13,%\nF6,27,%\n")
			expect(codes(run(chart('data-chart-source="share.csv"', ["0", "10", "20", "30"], ["27%"]), { baseDir: dir }))).toEqual(["chart_value_untraceable"])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	test("#given the ledger #when exported #then each active value row gives fact_id, plot_value and unit", () => {
		const rows = exportRows(LEDGER) as { fact_id: string; plot_value: string; unit: string }[]
		expect(rows.find((row) => row.fact_id === "F5")).toMatchObject({ plot_value: "12", unit: "%" })
		expect(rows.some((row) => row.fact_id === "Q1")).toBe(false)
	})
})
