// Architecture contract (retention bar): each shared table, list, regex, or classifier has one owner
// export, so a reintroduced local copy in a consumer fails one of these tests (#11156 sweep).
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { countDefects, DEFECT_CODES, SEVERITIES } from "./contracts.mjs"
import { meaningStatus, PROMOTION, promotionEligibility } from "./fact-commands-meaning.mjs"
import { editionFormatOf, MD_HTML_BLOCK_RULES, markdownAsHtml, projectMarkdownInline } from "./fact-commands-verify.mjs"
import { EXEMPT_KINDS, isExemptKind } from "./fidelity-binding.mjs"
import { blocksDelivery } from "./gates-fidelity.mjs"
import { MD_BLOCK_PATTERNS, parseMarkdown } from "./md-lite.mjs"
import { DRIFT_KINDS, isDriftKind, MODEL_TIERS, VERDICT_SCHEMA, VERDICTS } from "./meaning-check.mjs"
import { parseRenderedQuote, renderQuote } from "./placeholder.mjs"

const source = (name: string) => readFileSync(join(import.meta.dir, name), "utf8")

describe("severity vocabulary comes from contracts", () => {
	test("#given DEFECT_CODES #when its severities are collected #then they are exactly SEVERITIES", () => {
		const used = new Set(Object.values(DEFECT_CODES).map((entry) => entry.severity))
		expect([...used].sort()).toEqual([...SEVERITIES].sort())
		expect(Object.isFrozen(SEVERITIES)).toBe(true)
	})

	test("#given defects of every severity #when counted #then the buckets are SEVERITIES plus total", () => {
		const defects = SEVERITIES.map((severity) => ({ severity }))
		expect(Object.keys(countDefects(defects))).toEqual([...SEVERITIES, "total"])
		expect(countDefects(defects)).toEqual({ ...Object.fromEntries(SEVERITIES.map((severity) => [severity, 1])), total: SEVERITIES.length })
	})

	test("#given every registry code and an unknown code #when the meaning status is computed #then it follows blocksDelivery", () => {
		for (const code of [...Object.keys(DEFECT_CODES), "not_a_registered_code"]) {
			expect(meaningStatus([{ code, severity: "minor" }]), code).toBe(blocksDelivery({ code }) ? "fail" : "pass")
		}
		expect(meaningStatus([])).toBe("pass")
	})

	test("#given the command modules #when read #then none restates the severity buckets, the pair kinds, or a window literal", () => {
		for (const name of ["fact-commands-meaning.mjs", "fact-commands-verify.mjs"]) {
			const text = source(name)
			expect(text, name).not.toMatch(/blocker:\s*0/u)
			expect(text, name).not.toMatch(/\["quote",\s*"claim",\s*"translation"\]/u)
			expect(text, name).not.toMatch(/slice\(-\d+\)/u)
			expect(text, name).not.toMatch(/counts\.blocker \+ counts\.major/u)
		}
	})
})

describe("one sha256 helper", () => {
	test("#given every runtime module #when read #then only cli-support builds a hash, so records and receipts share sha256Of", () => {
		const modules = readdirSync(import.meta.dir).filter((name) => name.endsWith(".mjs") && name !== "cli-support.mjs")
		expect(modules.length).toBeGreaterThan(0)
		for (const name of modules) expect(source(name), name).not.toMatch(/createHash\(/u)
		expect(sha256Of("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
		expect(sha256Of(Buffer.from("abc"))).toBe(sha256Of("abc"))
	})
})

describe("calibration policy is the exported PROMOTION", () => {
	const confirmedRun = (run: string, disputed: boolean) => ({ run_id: run, confirmed: true, disputed })

	test("#given false blocks only before the window #when eligibility is computed #then they are not counted", () => {
		const window = PROMOTION.false_block_window
		expect(Number.isInteger(window) && window > 0).toBe(true)
		const old = [0, 1, 2].map((n) => confirmedRun(`old${n}`, true))
		const recent = Array.from({ length: window }, (_, n) => confirmedRun(`new${n}`, false))
		expect(promotionEligibility([...old, ...recent]).report_false_blocks_in_window).toBe(0)
		expect(promotionEligibility([...recent, ...old]).report_false_blocks_in_window).toBe(3)
	})

	test("#given false blocks at the policy maximum #when eligibility is computed #then the threshold read from PROMOTION decides", () => {
		const limit = PROMOTION.max_report_false_blocks_in_window
		const clean = Array.from({ length: PROMOTION.min_runs * 20 }, (_, n) => confirmedRun(`c${n}`, false))
		const blocks = (count: number) => Array.from({ length: count }, (_, n) => confirmedRun(`b${n}`, true))
		expect(promotionEligibility([...clean, ...blocks(limit)]).eligible).toBe(true)
		expect(promotionEligibility([...clean, ...blocks(limit + 1)]).eligible).toBe(false)
	})
})

describe("verdict schema comes from the meaning-check registries", () => {
	test("#given VERDICT_SCHEMA #when read #then its vocabularies are the owner exports", () => {
		expect(VERDICT_SCHEMA.verdict).toBe(VERDICTS)
		expect(VERDICT_SCHEMA.model_tier).toBe(MODEL_TIERS)
		expect(VERDICT_SCHEMA.drift_kind).toBe(DRIFT_KINDS)
		expect(Object.isFrozen(VERDICTS)).toBe(true)
	})

	test("#given every drift kind and a stranger #when checked #then isDriftKind is membership in DRIFT_KINDS", () => {
		for (const kind of DRIFT_KINDS) expect(isDriftKind(kind)).toBe(true)
		expect(isDriftKind("not_a_kind")).toBe(false)
		expect(source("meaning-check.mjs")).not.toMatch(/new Set\(DRIFT_KINDS\)|new Set\(\["drift"/u)
	})
})

describe("inherited lexical tables come from their owners", () => {
	test("#given fact-pairs #when read #then it holds no Hangul range, exempt-kind set, or hand-built hedge regex", () => {
		const text = source("fact-pairs.mjs")
		expect(text).not.toMatch(/\\uAC00-\\uD7A3/u)
		expect(text).not.toMatch(/\["opinion",\s*"recommendation"\]/u)
		expect(text).not.toMatch(/new RegExp\(/u)
	})

	test("#given EXEMPT_KINDS #when checked #then isExemptKind is membership in it", () => {
		for (const kind of EXEMPT_KINDS) expect(isExemptKind(kind)).toBe(true)
		expect(isExemptKind("finding")).toBe(false)
		expect(isExemptKind(undefined)).toBe(false)
	})

	test("#given md-lite #when its block grammar is read #then MD_BLOCK_PATTERNS names every block regex", () => {
		expect(Object.keys(MD_BLOCK_PATTERNS).sort()).toEqual(["BLOCKQUOTE", "CLOSING_HASHES", "FENCE", "HEADING", "LIST_ITEM", "TABLE_SEPARATOR", "THEMATIC_BREAK"])
		for (const pattern of Object.values(MD_BLOCK_PATTERNS)) expect(pattern).toBeInstanceOf(RegExp)
		expect(Object.isFrozen(MD_BLOCK_PATTERNS)).toBe(true)
	})
})

describe("markdown projection rules", () => {
	const EVERY_KIND = ["# Title", "", "Para text.", "", "- item", "", "> quoted", "", "| a | b |", "| - | - |", "| 1 | 2 |", "", "```", "code", "```", ""].join("\n")

	test("#given every block kind md-lite emits #when projected #then each kind has a projection rule", () => {
		const kinds = [...new Set(parseMarkdown(EVERY_KIND).blocks.map((block: { kind: string }) => block.kind))].sort()
		expect(kinds).toEqual(["blockquote", "code", "heading", "list_item", "paragraph", "table_row"])
		for (const kind of kinds) expect(Object.hasOwn(MD_HTML_BLOCK_RULES, kind), kind).toBe(true)
		expect(Object.keys(MD_HTML_BLOCK_RULES).sort()).toEqual(kinds)
		const { html } = markdownAsHtml(EVERY_KIND, [], { rows: [] })
		expect(html).toContain("<h1>Title</h1>")
		expect(html).toContain("<ul><li>item</li></ul>")
		expect(html).toMatch(/<table><tr><td>a<\/td><td>b<\/td><\/tr>\s*<tr><td>1<\/td><td>2<\/td><\/tr><\/table>/u)
	})

	test("#given an unterminated fence #when projected #then it is refused naming the line", () => {
		expect(() => markdownAsHtml("Intro.\n\n```\nno close\n", [], { rows: [] })).toThrow(/unterminated_fence at line 3/u)
	})

	test("#given inline links and code #when projected #then they stay elements and the rest is escaped", () => {
		expect(projectMarkdownInline("a <b> [x](https://e.x) `c`")).toBe('a &lt;b&gt; <a href="https://e.x">x</a> <code>c</code>')
	})

	test("#given a fill map with quotes in translates and fact_id #when projected #then the attributes are escaped", () => {
		const md = "Before X after.\n\n> Quoted block.\n"
		const span = { fact_id: 'F"1', start: 7, end: 8, rendered: "X", translates: 'T"1' }
		const block = { fact_id: 'Q"2', start: md.indexOf(">"), end: md.length - 1, rendered: "", replaced: "a" }
		const { html } = markdownAsHtml(md, [span, block], { rows: [] })
		expect(html).toContain('data-translates="T&quot;1"')
		expect(html).toContain('data-fact="Q&quot;2"')
		expect(markdownAsHtml("Before X after.\n", [{ ...span, translates: undefined }], { rows: [] }).html).toContain('data-fact="F&quot;1"')
		expect(html).not.toMatch(/="[^"]*"1"/u)
	})

	test("#given paths of each case #when the format is inferred #then md and markdown are Markdown and a flag wins", () => {
		expect(["r.md", "R.MD", "r.markdown", "r.html", "r.txt"].map((path) => editionFormatOf(path, undefined))).toEqual(["md", "md", "md", "html", "html"])
		expect(editionFormatOf("r.md", "html")).toBe("html")
	})
})

describe("rendered quotes round-trip through the placeholder owner", () => {
	const row = { fact_id: "Q1", kind: "quote", source_id: "S4", quote: "We estimate completion no earlier than 2027." }
	const selections = [
		["full", row.quote],
		["lead=2", "We estimate"],
		["from=completion,to=2027", "completion no earlier than 2027"],
	]

	for (const [selector, text] of selections) {
		test(`#given a ${selector} quote rendered for md #when projected #then the quote element and marker survive`, () => {
			const rendered = renderQuote(row, selector, text, "md")
			expect(parseRenderedQuote(rendered)).toEqual({ text, marker: "[S4]" })
			const md = `The operator wrote ${rendered}.\n`
			const entry = { fact_id: "Q1", start: md.indexOf(rendered), end: md.indexOf(rendered) + rendered.length, rendered, selector }
			const projected = markdownAsHtml(md, [entry], { rows: [row] })
			expect(projected.html).toContain(renderQuote(row, selector, text, "html"))
			expect(projected.stale).toEqual([])
			const edited = md.replace(text, `${text} indeed`)
			const stale = markdownAsHtml(edited, [{ ...entry, end: entry.end + " indeed".length }], { rows: [row] })
			expect(stale.html).not.toContain("<q ")
			expect(stale.stale).toHaveLength(1)
		})
	}

	test("#given bytes that are not the md quote layout #when parsed #then null", () => {
		expect(parseRenderedQuote("plain text [S4]")).toBeNull()
	})
})
