import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { fill } from "./fact-fill.mjs"
import { retractRow, supersedeRow, validateLedger } from "./fact-ledger.mjs"
import { failureCount, sentenceKey } from "./fidelity-state.mjs"

const LEDGER = JSON.parse(readFileSync(join(import.meta.dir, "tests/fixtures/fidelity/ledger-basic.json"), "utf8"))
const F12_DATA = '<data class="fact" value="320" data-fact="F12" data-unit="m" data-lineage="MEASURED">320 m</data>'
const QUOTE = "we estimate completion no earlier than 2027"
// Korean particles and words, as escapes: eul, girok, i, ollatda, ga, isang.
const EUL = "\uC744"
const GIROK = "\uAE30\uB85D"
const I = "\uC774"
const OLLATDA = "\uC62C\uB790\uB2E4"
const GA = "\uAC00"
const ISANG = "\uC774\uC0C1"

type State = { schemaVersion: number; failures: Record<string, number>; replaced: string[] }
function failedTwice(key: string): State {
	return { schemaVersion: 1, failures: { [key]: 2 }, replaced: [] }
}
const codes = (list: { code: string }[]) => list.map((item) => item.code)

describe("fill: fixture", () => {
	test("the ledger fixture is a valid ledger", () => {
		expect(validateLedger(LEDGER)).toEqual([])
	})
})

describe("fill: value placeholders (html)", () => {
	test("{{F12:span_len}} renders the <data> element with the raw text", () => {
		const result = fill("<p>The span is {{F12:span_len}}.</p>", LEDGER, { format: "html" })
		expect(result.errors).toEqual([])
		expect(result.out).toBe(`<p>The span is ${F12_DATA}.</p>`)
		expect(result.fillMap).toHaveLength(1)
		expect(result.fillMap[0]).toMatchObject({ token: "{{F12:span_len}}", fact_id: "F12", rendered: F12_DATA })
	})

	test(":q copies the source qualifier with the quantity", () => {
		const result = fill("<p>{{F12:span_len:q}}</p>", LEDGER, { format: "html" })
		expect(result.out).toContain('data-lineage="MEASURED">up to 320 m</data>')
	})

	test(":value and :unit render one part each", () => {
		const result = fill("<p>{{F12:span_len:value}} metres, unit {{F12:span_len:unit}}</p>", LEDGER, { format: "md" })
		expect(result.out).toBe("<p>320 metres, unit m</p>")
	})

	test("a converted row renders DERIVED lineage", () => {
		const result = fill("<p>{{F40:span_mm}}</p>", LEDGER, { format: "html" })
		expect(result.out).toContain('data-fact="F40" data-unit="mm" data-lineage="DERIVED">320000 mm</data>')
	})

	test("an all-English template fills with no warnings", () => {
		const result = fill("The span is {{F12:span_len}} long.", LEDGER, { format: "html" })
		expect(result.out).not.toBeNull()
		expect(result.warnings).toEqual([])
	})
})

describe("fill: fatal errors write nothing", () => {
	test("a label mismatch is pointer_label_mismatch with out null", () => {
		const result = fill("<p>Line one.</p>\n<p>{{F12:wrong}}</p>", LEDGER, { format: "html" })
		expect(result.out).toBeNull()
		expect(result.errors[0]).toMatchObject({ code: "pointer_label_mismatch", token: "{{F12:wrong}}", line: 2 })
	})

	test("an unknown id is unresolved_placeholder; no row is guessed", () => {
		const result = fill("<p>{{F99:x}}</p>", LEDGER, { format: "html" })
		expect(result.out).toBeNull()
		expect(codes(result.errors)).toEqual(["unresolved_placeholder"])
	})

	test("a malformed pointer is unresolved_placeholder", () => {
		expect(codes(fill("<p>{{F12}}</p>", LEDGER, { format: "html" }).errors)).toEqual(["unresolved_placeholder"])
	})

	test("a unit typed after a value placeholder is unit_duplicated, never absorbed", () => {
		const result = fill("<p>{{F13:rate}}%</p>", LEDGER, { format: "html" })
		expect(result.out).toBeNull()
		expect(codes(result.errors)).toEqual(["unit_duplicated"])
		expect(fill("<p>{{F13:rate:value}}%</p>", LEDGER, { format: "html" }).errors).toEqual([])
	})

	test("a retracted row is unresolved_placeholder; fill never renders it", () => {
		const ledger = structuredClone(LEDGER)
		retractRow(ledger, "F12", "source withdrawn")
		expect(validateLedger(ledger)).toEqual([])
		const result = fill("<p>Line one.</p>\n<p>{{F12:span_len}}</p>", ledger, { format: "html" })
		expect(result.out).toBeNull()
		expect(result.fillMap).toEqual([])
		expect(result.errors).toEqual([{ code: "unresolved_placeholder", token: "{{F12:span_len}}", line: 2, message: "F12 is retracted; cite its replacement" }])
	})

	test("a superseded row is unresolved_placeholder; fill never renders it", () => {
		const ledger = structuredClone(LEDGER)
		supersedeRow(ledger, "F12", "F40", "restated in mm")
		expect(validateLedger(ledger)).toEqual([])
		const result = fill("{{F12:span_len:value}}", ledger, { format: "md" })
		expect(result.out).toBeNull()
		expect(result.fillMap).toEqual([])
		expect(result.errors).toEqual([{ code: "unresolved_placeholder", token: "{{F12:span_len:value}}", line: 1, message: "F12 is superseded; cite its replacement" }])
	})

	test("an anchor occurring twice is quote_anchor_unresolved", () => {
		const result = fill('<p>{{Q7:completion:from="ti":to="2027"}}</p>', LEDGER, { format: "html" })
		expect(result.out).toBeNull()
		expect(codes(result.errors)).toEqual(["quote_anchor_unresolved"])
	})
})

describe("fill: quote placeholders", () => {
	test("from/to renders the sub-span in quotes plus the source marker", () => {
		const result = fill('<p>{{Q7:completion:from="no earlier":to="2027"}}</p>', LEDGER, { format: "html" })
		expect(result.out).toBe('<p><q data-fact="Q7" data-quote-sel="from=no earlier;to=2027">\u2026no earlier than 2027</q> [S4]</p>')
	})

	test("full and lead selectors", () => {
		expect(fill("{{Q7:completion}}", LEDGER, { format: "html" }).out).toBe(`<q data-fact="Q7" data-quote-sel="full">${QUOTE}</q> [S4]`)
		expect(fill("{{Q7:completion:lead=2}}", LEDGER, { format: "html" }).out).toBe('<q data-fact="Q7" data-quote-sel="lead=2">we estimate\u2026</q> [S4]')
	})

	test("md format puts the selector into fillMap", () => {
		const result = fill("{{Q7:completion:lead=2}}", LEDGER, { format: "md" })
		expect(result.out).toBe('"we estimate\u2026" [S4]')
		expect(result.fillMap[0]).toMatchObject({ fact_id: "Q7", selector: "lead=2", quote_span: [0, 11] })
	})

	test("a translation span after a quote placeholder is preserved and mapped", () => {
		const source = '{{Q7:completion}} <span data-translates="Q7">translation</span> rest'
		const result = fill(source, LEDGER, { format: "html" })
		expect(result.out).toContain('<span data-translates="Q7">translation</span> rest')
		const entry = result.fillMap.find((item: { translates?: string }) => item.translates === "Q7")
		expect(entry).toBeDefined()
		expect(result.out.slice(entry.start, entry.end)).toBe(entry.rendered)
		const md = fill("{{Q7:completion}} <!-- translates: Q7 --> translation", LEDGER, { format: "md" })
		expect(md.fillMap.some((item: { translates?: string }) => item.translates === "Q7")).toBe(true)
	})
})

describe("fill: Korean particles", () => {
	test("a closed final keeps eul", () => {
		const result = fill(`<p>{{F21:hbm_rev}}${EUL} ${GIROK}</p>`, LEDGER, { format: "html" })
		expect(result.out).toContain(`</data>${EUL} ${GIROK}`)
		expect(result.warnings).toEqual([])
	})

	test("percent is open: i becomes ga", () => {
		const result = fill(`<p>{{F13:rate}}${I} ${OLLATDA}</p>`, LEDGER, { format: "html" })
		expect(result.out).toContain(`15.2%</data>${GA} ${OLLATDA}`)
	})

	test("a candidate particle with no boundary is untouched and warned", () => {
		const result = fill(`<p>{{F13:rate}}${ISANG}</p>`, LEDGER, { format: "html" })
		expect(result.out).toContain(`</data>${ISANG}</p>`)
		expect(codes(result.warnings)).toEqual(["particle_unverified"])
	})
})

describe("fill: md maps", () => {
	test("fillMap offsets slice to the rendered text", () => {
		const result = fill(`# Findings\n\nSpan {{F12:span_len}}, rate {{F13:rate}}${I} ${OLLATDA}, {{Q7:completion:lead=3}}.\n`, LEDGER, { format: "md" })
		expect(result.errors).toEqual([])
		expect(result.fillMap).toHaveLength(3)
		for (const entry of result.fillMap) expect(result.out.slice(entry.start, entry.end)).toBe(entry.rendered)
		expect(result.fillMap[0].rendered).toBe("320 m")
		expect(result.out).toContain(`15.2%${GA}`)
	})
})

describe("fill: replace-failed", () => {
	const SOURCE = '<h2 id="findings">Findings</h2>\n<p>Completion slips: {{Q7:completion}}. Other text stays.</p>'
	const KEY = sentenceKey("findings", ["Q7"])

	test("a key that failed twice becomes the attributed blockquote; no entity warns", () => {
		const state = failedTwice(KEY)
		const result = fill(SOURCE, LEDGER, { format: "html", replaceFailed: state })
		expect(result.out).not.toBeNull()
		expect(result.out).toContain(`<blockquote data-fact="Q7" data-replaced="${KEY}">`)
		expect(result.out).toContain(`"${QUOTE}"`)
		expect(result.out).toContain("<footer>[S4]</footer>")
		expect(result.out).toContain("Other text stays.</p>")
		expect(result.out).not.toContain("Completion slips")
		expect(codes(result.warnings)).toEqual(["fallback_without_entity"])
		expect(state.replaced).toEqual([KEY])
	})

	test("a row with entity and valid_at carries them in the footer", () => {
		const source = `<h2>Market</h2>\n<p>Revenue was {{F21:hbm_rev}}.</p>`
		const result = fill(source, LEDGER, { format: "html", replaceFailed: failedTwice(sentenceKey("market", ["F21"])) })
		expect(result.out).toContain("<footer>[S5], on HBM3E (2026 Q3)</footer>")
		expect(result.warnings).toEqual([])
	})

	test("a key below two failures is filled normally", () => {
		const state: State = { schemaVersion: 1, failures: { [KEY]: 1 }, replaced: [] }
		const result = fill(SOURCE, LEDGER, { format: "html", replaceFailed: state })
		expect(result.out).toContain("Completion slips:")
		expect(state.replaced).toEqual([])
	})

	test("fallback omit removes the sentence", () => {
		const result = fill(SOURCE, LEDGER, { format: "html", replaceFailed: failedTwice(KEY), fallback: "omit" })
		expect(result.out).toBe('<h2 id="findings">Findings</h2>\n<p> Other text stays.</p>')
	})

	test("view leaves the state unchanged", () => {
		const state = failedTwice(KEY)
		const result = fill(SOURCE, LEDGER, { format: "html", replaceFailed: state, view: true })
		expect(result.out).toContain("<blockquote")
		expect(state.replaced).toEqual([])
		expect(failureCount(state, KEY)).toBe(2)
	})

	test("md renders a > block with the footer line", () => {
		const result = fill("## Findings\n\nCompletion slips: {{Q7:completion}}.\n", LEDGER, { format: "md", replaceFailed: failedTwice(KEY) })
		expect(result.out).toBe(`## Findings\n\n> "${QUOTE}"\n> [S4]\n`)
	})
})
