// fidelity-lexicon.mjs - closed-list lexical checks over (source quote, report sentence) pairs.
//
// lexiconChecks compares each pair with the lexicon.mjs lists: hedge_dropped, direction_flipped,
// causality_added, qualifier_dropped (six-token window around the fact span; a :q rendering puts
// the qualifier inside the span), scope_widened_warn, and the acronym-aware name_outside_quote.
// The hedge-position heuristic never yields a code; it only sets force_strong for the meaning
// verifier, as do name_outside_quote and scope_widened_warn. Latin terms match whole words (terms
// of four or more letters also match their inflections); Korean terms match as substrings, single
// syllables as tokens. No model, no IO. Plain Node ESM; Korean strings are \u escapes.

import { CAUSAL, CONCESSIVE, DIRECTION, HEDGES, NEGATION, QUALIFIERS, SCOPE_NARROW_TO_BROAD } from "./lexicon.mjs"
import { normalizeText } from "./text-normalize.mjs"
import { normalizeUnit } from "./units.mjs"

/** Ledger qualifier terms -> their surface forms in either language (closed mapping). */
export const QUALIFIER_FORMS = Object.freeze({
	upper_inclusive: ["up to", "at most", "\uCD5C\uB300", "\uC774\uD558", "\uAE4C\uC9C0"],
	lower_inclusive: ["at least", "\uCD5C\uC18C", "\uC774\uC0C1"],
	approximate: ["about", "approximately", "\uC57D", "\uB0B4\uC678"],
	near: ["nearly"],
	lower_exclusive: ["over", "more than", "\uCD08\uACFC"],
	upper_exclusive: ["under", "less than", "\uBBF8\uB9CC"],
})
/** Irregular and synonym direction forms the stem match cannot reach ("rose", "reduced"). */
const DIRECTION_FORMS = { up: ["rose", "risen", "rising", "grew", "grown", "gain"], down: ["reduc", "fell", "fallen", "falling", "drop", "lower"] }
const KOREAN = /[\uAC00-\uD7A3]/
/** True when the term holds a Hangul syllable (Korean terms match by the Korean rules below). */
export const isKoreanTerm = (term) => KOREAN.test(term)
/** The guarded hedge and qualifier vocabulary: the union of HEDGES, QUALIFIERS and every QUALIFIER_FORMS surface form. */
export const guardedTerms = () => [...new Set([...HEDGES, ...QUALIFIERS, ...Object.values(QUALIFIER_FORMS).flat()])]
const ACRONYM = /(?<![\p{L}\p{N}])[A-Z]{2,6}(?![\p{L}\p{N}])/gu
const WINDOW = 6
const cache = new Map()

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The lexical pattern engine. mode: "stem" (inflections, Korean one-syllable token prefix), "exact",
 * "word", "suffix" (Korean attached to a value), "guard" (single Latin words of four or more letters
 * take inflections, multiword terms never do; Korean terms match as plain substrings).
 */
export function lexicalPattern(term, mode) {
	const key = `${mode}\u0001${term}`
	if (cache.has(key)) return cache.get(key)
	let source
	if (!KOREAN.test(term)) {
		const stems = term.length >= 4 && (mode === "stem" || (mode === "guard" && !term.includes(" ")))
		source = `(?<![\\p{L}\\p{N}])${escape(term).replace(/ /g, "\\s+")}${stems ? "\\p{L}*" : ""}(?![\\p{L}\\p{N}])`
	} else if (mode === "guard") source = escape(term)
	else if (mode === "suffix") source = `(?<=^|[\\s\\p{P}\\p{N}A-Za-z])${escape(term)}(?=$|[\\s\\p{P}])`
	else if ([...term].length >= 2 || mode === "word") source = escape(term)
	else source = `(?<=^|[\\s\\p{P}])${escape(term)}${mode === "stem" ? "" : "(?=$|[\\s\\p{P}])"}`
	const re = new RegExp(source, "giu")
	cache.set(key, re)
	return re
}

function positions(text, terms, mode) {
	const out = []
	for (const term of terms) for (const match of text.matchAll(lexicalPattern(term, mode))) out.push({ term, at: match.index })
	return out.sort((a, b) => a.at - b.at)
}

const has = (text, terms, mode) => positions(text, terms, mode).length > 0
const tokens = (text) => text.split(/\s+/).filter(Boolean)
const stripQualifiers = (text) => QUALIFIERS.reduce((rest, term) => rest.replace(lexicalPattern(term, "exact"), " "), text)

function directions(text) {
	const rest = stripQualifiers(text)
	return {
		up: has(rest, DIRECTION.up, "stem") || has(rest, DIRECTION_FORMS.up, "stem"),
		down: has(rest, DIRECTION.down, "stem") || has(rest, DIRECTION_FORMS.down, "stem"),
	}
}

/** The fact span plus up to six tokens on each side, never crossing the sentence. */
function qualifierWindow(sentence, span) {
	const [start, end] = span
	return [...tokens(sentence.slice(0, start)).slice(-WINDOW), sentence.slice(start, end), ...tokens(sentence.slice(end)).slice(0, WINDOW)].join(" ")
}

function qualifierDropped(pair) {
	if (!pair.qualifier || !Array.isArray(pair.span)) return false
	const forms = QUALIFIER_FORMS[pair.qualifier] ?? [pair.qualifier]
	const window = qualifierWindow(pair.sentence, pair.span)
	return !forms.some((form) => has(window, [form], KOREAN.test(form) ? "suffix" : "exact"))
}

/** A hedge before the sentence's last concessive while the quote hedges its own final clause. */
function hedgeMoved(quote, sentence) {
	const lastConcessive = (text) => positions(text, CONCESSIVE, "word").at(-1)?.at ?? -1
	const sentenceHedge = positions(sentence, HEDGES, "stem")[0]?.at
	const quoteHedge = positions(quote, HEDGES, "stem").at(-1)?.at
	const sentenceConcessive = lastConcessive(sentence)
	return sentenceHedge !== undefined && quoteHedge !== undefined && sentenceHedge < sentenceConcessive && quoteHedge > lastConcessive(quote)
}

function pairFindings(pair) {
	const quote = normalizeText(pair.quote)
	const sentence = normalizeText(pair.sentence)
	const found = []
	const add = (code, message) => found.push({ pair_id: pair.pair_id, code, message })
	const dropped = qualifierDropped(pair)
	if (dropped) add("qualifier_dropped", `the source bounds the value (${pair.qualifier}) and the sentence drops it`)
	const sourceHedges = positions(quote, HEDGES, "stem")
	const qualifierOnly = sourceHedges.every(({ term }) => QUALIFIERS.includes(term))
	if (sourceHedges.length > 0 && !has(sentence, HEDGES, "stem") && !(dropped && qualifierOnly)) {
		add("hedge_dropped", `the source hedges ("${sourceHedges[0].term}") and the sentence does not`)
	}
	const [from, to] = [directions(quote), directions(sentence)]
	const negated = has(quote, NEGATION, "word") || has(sentence, NEGATION, "word")
	if (!negated && ((from.up && !from.down && to.down && !to.up) || (from.down && !from.up && to.up && !to.down))) {
		add("direction_flipped", `the source says ${from.up ? "up" : "down"} and the sentence says ${to.up ? "up" : "down"}`)
	}
	const causal = positions(sentence, CAUSAL, "word").find(({ term }) => !has(quote, [term], "word"))
	if (causal) add("causality_added", `"${causal.term}" states a cause the source does not`)
	const context = [quote, ...(pair.context ?? []).map(normalizeText)]
	for (const [narrow, broad] of SCOPE_NARROW_TO_BROAD) {
		if (has(quote, [narrow], "word") && has(sentence, [broad], "word") && !context.some((text) => has(text, [broad], "word"))) {
			add("scope_widened_warn", `the source says "${narrow}" and the sentence says "${broad}"`)
		}
	}
	const acronyms = pair.acronyms ?? {}
	const quoteNames = new Set(quote.match(ACRONYM) ?? [])
	const stray = (sentence.match(ACRONYM) ?? []).find((name) => !quoteNames.has(name) && !Object.hasOwn(acronyms, name) && !normalizeUnit(name))
	if (stray) add("name_outside_quote", `"${stray}" is in neither the quote nor the source's acronym table`)
	return found
}

/**
 * @param {{ pair_id: string, quote: string, sentence: string, span?: [number, number] | null,
 *   qualifier?: string | null, acronyms?: Record<string, string>, context?: string[] }[]} pairs
 * @returns {{ findings: { pair_id: string, code: string, message: string }[], forceStrong: string[] }}
 */
export function lexiconChecks(pairs) {
	const findings = []
	const forceStrong = []
	for (const pair of pairs) {
		const found = pairFindings(pair)
		findings.push(...found)
		const routed = found.some(({ code }) => code === "name_outside_quote" || code === "scope_widened_warn")
		if (routed || hedgeMoved(normalizeText(pair.quote), normalizeText(pair.sentence))) forceStrong.push(pair.pair_id)
	}
	return { findings, forceStrong }
}
