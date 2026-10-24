// fact-pairs.mjs - (source, report sentence) pairs for the meaning verifier.
//
// extractPairs walks the prose sentences of a filled HTML report and emits, in document order:
// a quote pair per distinct ledger quote cited by a findings sentence (facts sharing one quote
// share one pair), a claim pair per sentence bound only by data-claim (the statement comes from
// the claim index), and a translation pair per data-translates span. force_strong routes a pair
// to the strong reader when the lexicon raised name_outside_quote or scope_widened_warn, when the
// hedge-position heuristic fired, or when the source hedges and the sentence's last six tokens do
// not. No model, no IO: the readers run as separate lanes. Plain Node ESM; no Hangul here.

import { isExemptKind, proseSentences } from "./fidelity-binding.mjs"
import { isKoreanTerm, lexicalPattern, lexiconChecks } from "./fidelity-lexicon.mjs"
import { sentenceKey } from "./fidelity-state.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml, proseText } from "./html-lite.mjs"
import { HEDGES } from "./lexicon.mjs"
import { normalizeText } from "./text-normalize.mjs"

/** Every pair kind the producers below emit; consumers count and schema pairs by this list. */
export const PAIR_KINDS = Object.freeze(["quote", "claim", "translation"])
const TAIL = 6

const lang = (text) => (isKoreanTerm(text) ? "ko" : "en")
/** Sentence text with its fact spans cut out, so a Korean value does not make an English sentence Korean. */
const outsideFacts = (sentence) => sentence.facts.reduceRight((text, fact) => text.slice(0, fact.start - sentence.start) + text.slice(fact.end - sentence.start), sentence.text)

/** Latin hedges match whole words ("exact"); Korean hedges match as substrings, one syllable as a token prefix ("stem"). */
const HEDGE_RES = HEDGES.map((term) => lexicalPattern(term, isKoreanTerm(term) ? "stem" : "exact"))

/** Hedge terms that are also month names; capitalized and followed by a date number, they are months. */
const MONTH_WORDS = new Set(["may"])

/** A capitalized Latin match after the first word is a name or a month ("in May"), not a hedge. */
const isHedgeAt = (text, match) => {
	if (!/^\p{Lu}/u.test(match[0]) || isKoreanTerm(match[0])) return true
	if (match.index !== 0) return false
	// At the start of a text a capital is only sentence case, so the word still hedges - unless it is a
	// month name followed by a date number ("May 2024 sales rose.").
	return !(MONTH_WORDS.has(match[0].toLowerCase()) && /^\s+\p{Nd}/u.test(text.slice(match.index + match[0].length)))
}

export const hasHedge = (text) => {
	const normal = normalizeText(text)
	return HEDGE_RES.some((re) => [...normal.matchAll(re)].some((match) => isHedgeAt(normal, match)))
}

/** The source hedges and none of the sentence's last six tokens carries a hedge. */
function tailDropsHedge(source, sentence) {
	if (!hasHedge(source)) return false
	return !hasHedge(normalizeText(sentence).split(/\s+/u).filter(Boolean).slice(-TAIL).join(" "))
}

function slugOf(scope) {
	const heading = scope.section?.heading
	if (!heading) return ""
	return (heading.attrs.id ?? proseText(heading))
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
}

function claimMap(claims) {
	const list = Array.isArray(claims) ? claims : (claims?.claims ?? [])
	return new Map(list.map((claim) => [claim.claim_id, claim]))
}

const idsOf = (attr) => String(attr ?? "").split(/[\s,]+/u).filter(Boolean)

/** Claim ids that bind a sentence: on the block or an ancestor, or on an inner element whose text the sentence holds. */
function claimIdsFor(ctx, block, sentence) {
	const { closest, descendants } = ctx.util
	const up = block.owner.attrs["data-claim"] !== undefined ? block.owner : closest(block.owner, (node) => node.attrs?.["data-claim"] !== undefined)
	const ids = up ? idsOf(up.attrs["data-claim"]) : []
	const text = normalizeText(sentence.text)
	for (const node of descendants(block.owner)) {
		if (node.attrs?.["data-claim"] === undefined) continue
		const inner = normalizeText(proseText(node))
		if (inner !== "" && text.includes(inner)) ids.push(...idsOf(node.attrs["data-claim"]))
	}
	return [...new Set(ids)]
}

function exempt(ctx, node) {
	return isExemptKind(node.attrs["data-kind"]) || Boolean(ctx.util.closest(node, (cur) => isExemptKind(cur.attrs?.["data-kind"])))
}

/** Lexicon routing for every fact span of one quote group in one sentence. */
function lexiconRouted(group, sentence) {
	const probes = group.facts.map((fact, index) => ({
		pair_id: String(index),
		quote: group.quote,
		sentence: sentence.text,
		span: [fact.start - sentence.start, fact.end - sentence.start],
		qualifier: group.row.kind === "quote" ? null : (group.rows.get(fact.id)?.qualifier ?? null),
	}))
	return lexiconChecks(probes).forceStrong.length > 0
}

function quotePairs(sentence, rows, slug, reportLang) {
	const groups = new Map()
	for (const fact of sentence.facts) {
		const row = rows.get(fact.id)
		if (!row?.quote) continue
		const group = groups.get(row.quote) ?? { quote: row.quote, row, rows, facts: [], ids: [] }
		group.facts.push(fact)
		if (!group.ids.includes(fact.id)) group.ids.push(fact.id)
		groups.set(row.quote, group)
	}
	const allIds = [...new Set(sentence.facts.map((fact) => fact.id))]
	return [...groups.values()].map((group) => ({
		kind: "quote",
		sentence_key: sentenceKey(slug, allIds),
		fact_ids: [...group.ids].sort(),
		quote: group.quote,
		sentence: sentence.text,
		source_lang: lang(group.quote),
		report_lang: reportLang ?? lang(outsideFacts(sentence)),
		force_strong: lexiconRouted(group, sentence) || tailDropsHedge(group.quote, sentence.text),
	}))
}

function claimPairs(ctx, block, sentence, byClaim, slug, reportLang) {
	if (sentence.facts.length > 0 || exempt(ctx, block.owner)) return []
	return claimIdsFor(ctx, block, sentence)
		.map((id) => byClaim.get(id))
		.filter(Boolean)
		.map((claim) => ({
			kind: "claim",
			sentence_key: sentenceKey(slug, [claim.claim_id]),
			claim_id: claim.claim_id,
			statement: claim.statement,
			sentence: sentence.text,
			source_lang: lang(claim.statement),
			report_lang: reportLang ?? lang(sentence.text),
			force_strong: lexiconChecks([{ pair_id: "c", quote: claim.statement, sentence: sentence.text }]).forceStrong.length > 0 || tailDropsHedge(claim.statement, sentence.text),
		}))
}

function translationPair(node, rows, slug, reportLang) {
	const id = node.attrs["data-translates"]
	const row = rows.get(id)
	const text = proseText(node)
	if (!row?.quote || text === "") return null
	return {
		kind: "translation",
		sentence_key: sentenceKey(slug, [id]),
		fact_ids: [id],
		quote: row.quote,
		sentence: text,
		source_lang: lang(row.quote),
		report_lang: reportLang ?? lang(text),
		force_strong: tailDropsHedge(row.quote, text),
	}
}

/**
 * @param {string} html the filled report
 * @param {{ rows: object[] }} ledger
 * @param {{ claims: object[] } | object[] | null} claims indexClaims(...) output or its claims array
 * @returns {object[]} pairs with pair_id P1, P2, ... in document order
 */
export function extractPairs(html, ledger, claims) {
	const ctx = buildContext(parseHtml(html), {})
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const byClaim = claimMap(claims)
	const htmlLang = ctx.all.find((node) => node.tag === "html")?.attrs.lang
	const reportLang = htmlLang ? htmlLang.toLowerCase().split("-")[0] : null
	const out = []
	const seenSpans = new Set()
	for (const block of proseSentences(ctx)) {
		const findings = Boolean(block.scope.section) && block.kind === null
		if (!findings) continue
		const slug = slugOf(block.scope)
		for (const sentence of block.sentences) {
			out.push(...quotePairs(sentence, rows, slug, reportLang), ...claimPairs(ctx, block, sentence, byClaim, slug, reportLang))
		}
		for (const node of ctx.util.descendants(block.owner)) {
			if (node.attrs?.["data-translates"] === undefined || seenSpans.has(node)) continue
			seenSpans.add(node)
			const pair = translationPair(node, rows, slug, reportLang)
			if (pair) out.push(pair)
		}
	}
	return out.map((pair, index) => ({ pair_id: `P${index + 1}`, ...pair }))
}
