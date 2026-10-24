import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { indexClaims } from "./claims-index.mjs"
import { extractPairs, hasHedge } from "./fact-pairs.mjs"
import { fill } from "./fact-fill.mjs"

type Row = Record<string, unknown> & { fact_id: string }
type Pair = Record<string, unknown> & { pair_id: string; kind: string; sentence: string }

const FIXTURES = join(import.meta.dir, "tests/fixtures/fidelity")
const BASE = JSON.parse(readFileSync(join(FIXTURES, "ledger-basic.json"), "utf8")) as { schemaVersion: number; rows: Row[] }
const Q7 = BASE.rows.find((row) => row.fact_id === "Q7")
if (Q7 === undefined) throw new Error("ledger-basic.json lost Q7")
const Q8 = { ...Q7, fact_id: "Q8", label: "outlook", quote: "Demand may recover in 2027" }
const LEDGER = { ...BASE, rows: [...BASE.rows, Q8] }
const CLAIMS = indexClaims(readFileSync(join(FIXTURES, "claim-graph.md"), "utf8"))

const SOURCE = [
	"<!doctype html><html lang=\"en\"><body>",
	"<h1>Bridge report</h1>",
	"<h2 id=\"findings\">Findings</h2>",
	"<p>The span is {{F12:span_len:q}}, or {{F40:span_mm}} [S4].</p>",
	"<p>The rate is {{F13:rate}} [S4].</p>",
	"<p>The operator wrote {{Q8:outlook}}, so the recovery is certain and fully funded now.</p>",
	"<p>The note says {{Q7:completion}}<span data-translates=\"Q7\">completion is not expected before 2027</span>.</p>",
	"<p data-claim=\"C2\">Revenue grew 10 percent in 2025.</p>",
	"<p data-kind=\"opinion\">This looks like a sound plan.</p>",
	"<h2>Sources</h2>",
	"<ol><li id=\"s4\">[S4] Bridge authority page, retrieved 2026-10-01. Its span is {{F13:rate}}.</li></ol>",
	"</body></html>",
].join("\n")

function filled(): { out: string; fillMap: { fact_id: string }[] } {
	const result = fill(SOURCE, LEDGER, { format: "html" })
	if (result.out === null) throw new Error(`fixture failed to fill: ${JSON.stringify(result.errors)}`)
	return { out: result.out, fillMap: result.fillMap as { fact_id: string }[] }
}

function pairs(): Pair[] {
	const { out, fillMap } = filled()
	return extractPairs(out, LEDGER, CLAIMS, fillMap) as Pair[]
}

describe("extractPairs: a filled report", () => {
	test("#given the filled fixture #when extracted #then pairs come in document order with P ids", () => {
		const result = pairs()
		expect(result.map((pair) => [pair.pair_id, pair.kind])).toEqual([
			["P1", "quote"],
			["P2", "quote"],
			["P3", "quote"],
			["P4", "quote"],
			["P5", "translation"],
			["P6", "claim"],
		])
	})

	test("#given two facts sharing one source quote #when extracted #then one quote pair names both", () => {
		const [first] = pairs()
		expect(first).toMatchObject({
			kind: "quote",
			sentence_key: "findings#F12,F40",
			fact_ids: ["F12", "F40"],
			quote: "The bridge has a main span of up to 320 m.",
			source_lang: "en",
			report_lang: "en",
			force_strong: false,
		})
		expect(first.sentence).toContain("up to 320 m")
	})

	test("#given an unhedged quote with its value kept #when extracted #then force_strong stays false", () => {
		expect(pairs()[1]).toMatchObject({ fact_ids: ["F13"], quote: "The rate reached 15.2% in May.", force_strong: false })
	})

	test("#given a hedged quote whose sentence ends without a hedge #when extracted #then force_strong is true", () => {
		expect(pairs()[2]).toMatchObject({ fact_ids: ["Q8"], quote: "Demand may recover in 2027", force_strong: true })
	})

	test("#given a data-translates span #when extracted #then a translation pair carries the span text", () => {
		const result = pairs()
		expect(result[3]).toMatchObject({ kind: "quote", fact_ids: ["Q7"] })
		expect(result[4]).toMatchObject({
			kind: "translation",
			fact_ids: ["Q7"],
			quote: "we estimate completion no earlier than 2027",
			sentence: "completion is not expected before 2027",
		})
	})

	test("#given a sentence bound only by data-claim #when extracted #then a claim pair carries the node statement", () => {
		expect(pairs()[5]).toMatchObject({
			kind: "claim",
			claim_id: "C2",
			statement: "Revenue grew about 10 percent in 2025.",
			sentence: "Revenue grew 10 percent in 2025.",
			force_strong: true,
		})
	})

	test("#given an opinion paragraph and a sources section #when extracted #then neither yields a pair", () => {
		const sentences = pairs().map((pair) => pair.sentence)
		expect(sentences.some((text) => text.includes("sound plan"))).toBe(false)
		expect(sentences.some((text) => text.includes("Bridge authority"))).toBe(false)
	})

	test("#given a fill map that omits a fact #when extracted #then that hand-typed fact yields no pair", () => {
		const { out, fillMap } = filled()
		const kept = fillMap.filter((entry) => entry.fact_id !== "F13")
		const result = extractPairs(out, LEDGER, CLAIMS, kept) as Pair[]
		expect(result.some((pair) => Array.isArray(pair.fact_ids) && (pair.fact_ids as string[]).includes("F13"))).toBe(false)
	})

	test("#given no fill map #when extracted #then every data-fact element counts as filled", () => {
		const { out } = filled()
		expect((extractPairs(out, LEDGER, CLAIMS) as Pair[]).length).toBe(6)
	})

	test("#given a Hangul quote #when extracted #then source_lang is ko", () => {
		const html = "<html><body><h2>Findings</h2><p>HBM revenue reached {{F21:hbm_rev}} [S5].</p></body></html>"
		const result = fill(html, LEDGER, { format: "html" }) as { out: string; fillMap: { fact_id: string }[] }
		const [pair] = extractPairs(result.out, LEDGER, CLAIMS, result.fillMap) as Pair[]
		expect(pair).toMatchObject({ fact_ids: ["F21"], source_lang: "ko", report_lang: "en" })
	})
})

describe("extractPairs: a fill map over translations", () => {
	test("#given a fill map that omits the translated fact #when extracted #then no translation pair is emitted", () => {
		const { out, fillMap } = filled()
		const kept = fillMap.filter((entry) => entry.fact_id !== "Q7")
		const result = extractPairs(out, LEDGER, CLAIMS, kept) as Pair[]
		expect(result.some((pair) => pair.kind === "translation")).toBe(false)
	})
})

describe("hasHedge: a month is not a hedge", () => {
	test("#given a text that starts with the month May #when checked #then it does not count as hedged", () => {
		expect(hasHedge("May 2024 sales rose.")).toBe(false)
	})

	test("#given a sentence-initial modal may #when checked #then it still counts as hedged", () => {
		expect(hasHedge("May the figure hold through 2027.")).toBe(true)
		expect(hasHedge("Demand may recover in 2027.")).toBe(true)
	})
})

describe("extractPairs: determinism", () => {
	test("#given the same filled report twice #when extracted #then both results are byte-for-byte equal", () => {
		const { out, fillMap } = filled()
		const first = JSON.stringify(extractPairs(out, LEDGER, CLAIMS, fillMap))
		const second = JSON.stringify(extractPairs(out, LEDGER, CLAIMS, fillMap))
		expect(second).toBe(first)
	})
})

describe("extractPairs: the no-model contract", () => {
	test("#given the module source #when read #then it never fetches or imports a network or model client", () => {
		const text = readFileSync(join(import.meta.dir, "fact-pairs.mjs"), "utf8")
		expect(text).not.toMatch(/\bfetch\s*\(|node:https?|node:net|from\s+"(?!\.\/|node:)/u)
	})
})
