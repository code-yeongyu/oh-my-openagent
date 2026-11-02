import { describe, expect, test } from "bun:test"

import { guardedTerms, isKoreanTerm, lexicalPattern, lexiconChecks, QUALIFIER_FORMS } from "./fidelity-lexicon.mjs"
import { HEDGES, QUALIFIERS } from "./lexicon.mjs"

type Pair = { pair_id: string; quote: string; sentence: string; span?: [number, number] | null; qualifier?: string | null; acronyms?: Record<string, string> }
type Finding = { pair_id: string; code: string; message: string }
type Result = { findings: Finding[]; forceStrong: string[] }

function check(pair: Omit<Pair, "pair_id">): Result {
	return lexiconChecks([{ pair_id: "P1", ...pair }]) as Result
}

const codes = (result: Result) => result.findings.map((finding) => finding.code)

function withSpan(quote: string, sentence: string, fact: string, qualifier: string | null): Omit<Pair, "pair_id"> {
	const at = sentence.indexOf(fact)
	return { quote, sentence, span: [at, at + fact.length], qualifier }
}

describe("source-versus-sentence lexicon", () => {
	test("#given a hedged source and an unhedged sentence #when checked #then hedge_dropped", () => {
		expect(codes(check({ quote: "estimated 100억", sentence: "100억 달성" }))).toEqual(["hedge_dropped"])
	})

	test("#given the hedge kept #when checked #then clean", () => {
		expect(codes(check({ quote: "estimated 100억", sentence: "estimated 100억 달성" }))).toEqual([])
	})

	test("#given a source that falls and a sentence that rises #when checked #then direction_flipped", () => {
		expect(codes(check({ quote: "Costs were reduced last year.", sentence: "Costs increased last year." }))).toEqual(["direction_flipped"])
	})

	test("#given a negated sentence #when checked #then direction is routed, not flagged", () => {
		expect(codes(check({ quote: "Costs were reduced last year.", sentence: "Costs did not increase last year." }))).toEqual([])
	})

	test("#given a causal connective the source lacks #when checked #then causality_added", () => {
		expect(codes(check({ quote: "Sales rose and prices fell.", sentence: "Sales rose because prices fell." }))).toEqual(["causality_added"])
	})

	test("#given a narrow source scope and a broad sentence scope #when checked #then scope_widened_warn and force_strong", () => {
		const result = check({ quote: "북미 매출이 늘었다", sentence: "전 세계 매출이 늘었다" })
		expect(codes(result)).toEqual(["scope_widened_warn"])
		expect(result.forceStrong).toEqual(["P1"])
	})
})

describe("qualifiers", () => {
	const QUOTE = "The bridge span is up to 320 m long."

	test("#given an upper-bounded row and a sentence without the bound #when checked #then qualifier_dropped", () => {
		expect(codes(check(withSpan(QUOTE, "The span is 320 m long.", "320 m", "upper_inclusive")))).toEqual(["qualifier_dropped"])
	})

	test("#given the :q rendering inside the fact span #when checked #then clean", () => {
		expect(codes(check(withSpan(QUOTE, "The span is up to 320 m long.", "up to 320 m", "upper_inclusive")))).toEqual([])
	})

	test("#given the Korean surface form after the value #when checked #then the closed mapping accepts it", () => {
		expect(codes(check(withSpan("최대 320 m", "길이는 320 m 이하 수준이다", "320 m", "upper_inclusive")))).toEqual([])
	})

	test("#given a qualifier more than six tokens away #when checked #then it does not count", () => {
		const sentence = "Up to now the bridge, built over the long river, spans 320 m."
		expect(codes(check(withSpan(QUOTE, sentence, "320 m", "upper_inclusive")))).toEqual(["qualifier_dropped"])
	})
})

describe("names and routing", () => {
	test("#given an acronym in neither the quote nor the source's acronym table #when checked #then name_outside_quote and force_strong", () => {
		const result = check({ quote: "Demand rose in 2026.", sentence: "HBM demand rose in 2026.", acronyms: {} })
		expect(codes(result)).toEqual(["name_outside_quote"])
		expect(result.forceStrong).toEqual(["P1"])
	})

	test("#given the acronym listed in the source's acronym table #when checked #then clean", () => {
		expect(codes(check({ quote: "Demand rose in 2026.", sentence: "HBM demand rose in 2026.", acronyms: { HBM: "High Bandwidth Memory" } }))).toEqual([])
	})

	test("#given a hedge before a concessive in the sentence while the source hedges its final clause #when checked #then force_strong only", () => {
		const result = check({
			quote: "Revenue rose, but the margin is estimated to fall.",
			sentence: "The margin is estimated to fall, but revenue rose.",
		})
		expect(codes(result)).toEqual([])
		expect(result.forceStrong).toEqual(["P1"])
	})
})

describe("shared lexical owners used by polish (duplication sweep)", () => {
	const hits = (text: string, term: string, mode: string) => [...text.matchAll(lexicalPattern(term, mode))].length

	test("guardedTerms is the union of HEDGES, QUALIFIERS and every QUALIFIER_FORMS form", () => {
		const union = new Set([...HEDGES, ...QUALIFIERS, ...Object.values(QUALIFIER_FORMS).flat()])
		expect(new Set(guardedTerms())).toEqual(union)
		expect(guardedTerms().length).toBe(union.size)
	})

	test("isKoreanTerm detects Hangul", () => {
		expect(isKoreanTerm("\uC57D")).toBe(true)
		expect(isKoreanTerm("about")).toBe(false)
	})

	test("guard mode: single Latin words inflect, multiword terms do not, Korean matches as a substring", () => {
		expect(hits("it was estimatedly so", "estimated", "guard")).toBe(1)
		expect(hits("more thanks", "more than", "guard")).toBe(0)
		expect(hits("more than", "more than", "guard")).toBe(1)
		expect(hits("\uC608\uC57D", "\uC57D", "guard")).toBe(1)
	})

	test("stem mode keeps its own rules: multiword terms inflect and a one-syllable Korean term needs a boundary", () => {
		expect(hits("more thanks", "more than", "stem")).toBe(1)
		expect(hits("\uC608\uC57D", "\uC57D", "stem")).toBe(0)
		expect(hits("\uC57D 3", "\uC57D", "stem")).toBe(1)
	})
})
