// fidelity-trace.mjs - the numeral and quotation trace of the deterministic fidelity gate.
//
// Every numeral in prose and table cells outside sources, toc and chart figures (dates included)
// must sit in a data-fact, data-translates, q or blockquote element, or at the site of a fill-map
// entry; otherwise untraceable_number. Quoted runs with no Q row are quote_unbound, and leftover
// {{...}} pointers unresolved_placeholder. No model, no network.
//
// Fill-map assumption (fact-fill.mjs fill(), #11141): format "html" wraps every value and quote in
// <data data-fact> / <q data-fact> / <blockquote data-fact>, which this trace skips by element, so
// it needs no fill map. Format "md" writes bare text, and each fillMap entry is
// { fact_id, rendered, start, end } with start/end indexing the filled Markdown, not the HTML this
// gate reads. fill() pushes entries in output order and the Markdown-to-HTML step keeps text order,
// so each entry, in array order, is matched to the next untraced occurrence of its rendered text in
// document order that is a whole numeral and reads as the entry's row there (fits: "1,237 million"
// is not F2's 1,237), and strips that one occurrence only. A copy of the same text that no entry
// accounts for stays in the scan; an entry whose text is gone strips nothing. A derived or
// converted entry is located under the bracket grammar of fidelity-originals.mjs (renderLocator).

import { PROSE_TAGS } from "./html-lite.mjs"
import { NOT_CLAIMS } from "./numerals.mjs"
import { sourcesClaims, textClaims } from "./sources-citation.mjs"

/** Structural numerals: versions, figure/table/section references, times (NOT_CLAIMS 7-11), pages, citations, placeholders. */
export const STRUCTURAL = [...NOT_CLAIMS.slice(7, 12), /\b(?:p|pp|page|pages)\.?\s*\d+(?:\s*[-\u2013]\s*\d+)?/gi, /\[(?:S|Source\s*)\d+\]|\[\^\d+\]/gi, /\{\{[^}]*\}\}/g]
const NUMERAL = /\d+(?:[.,\-/:]\d+)*/g
const TRACED = "\u0000"
const QUOTE_RUNS = [/"([^"]+)"/g, /\u201C([^\u201C\u201D]+)\u201D/g, /\u300C([^\u300C\u300D]+)\u300D/g, /\u300E([^\u300E\u300F]+)\u300F/g]

export const clip = (text) => String(text).replace(/\s+/g, " ").trim().slice(0, 80)

function ownerTexts(ctx, charts) {
	const owners = new Map()
	for (const entry of ctx.texts) {
		const kind = ctx.kindOf(entry.scope)
		if (kind === "toc") continue
		if (kind === "sources") {
			if (!PROSE_TAGS.has(entry.owner.tag)) owners.set(entry.owner, `${owners.get(entry.owner) ?? ""} ${textClaims(entry.node.text).join(" ")}`)
			else if (!owners.has(entry.owner)) owners.set(entry.owner, sourcesClaims(entry.owner).join(" "))
			continue
		}
		if (charts.has(ctx.util.closest(entry.node, (cur) => cur.tag === "figure"))) continue
		const hidden = ctx.util.closest(entry.node, (cur) => cur.attrs["data-fact"] !== undefined || cur.attrs["data-translates"] !== undefined || cur.tag === "q" || cur.tag === "blockquote")
		owners.set(entry.owner, (owners.get(entry.owner) ?? "") + (hidden ? ` ${TRACED} ` : entry.node.text))
	}
	return owners
}

function scanOwner(ctx, owner, raw, flag) {
	let text = raw
	if (/^h[1-6]$/.test(owner.tag)) text = text.replace(/^\s*\d+(?:[.-]\d+)*[.):]?\s+/, " ")
	if (text.includes("{{")) flag("unresolved_placeholder", owner, `leftover placeholder: "${clip(text.slice(text.indexOf("{{")))}"`)
	for (const re of QUOTE_RUNS) {
		for (const match of text.matchAll(re)) {
			const inner = match[1].replaceAll(TRACED, " ").trim()
			const after = text.slice(match.index + match[0].length).trim().split(/\s+/).slice(0, 6).join(" ")
			if (inner && (inner.split(/\s+/).length >= 3 || ctx.util.citationMarker.test(after))) flag("quote_unbound", owner, `direct quotation with no Q row: "${clip(match[0])}"`)
		}
	}
	const rest = STRUCTURAL.reduce((acc, re) => acc.replace(re, " "), text)
	for (const match of rest.matchAll(NUMERAL)) flag("untraceable_number", owner, `number "${match[0]}" has no ledger row: "${clip(rest.slice(Math.max(0, match.index - 30), match.index + 30))}"`)
}

const plainSite = (entry, text, from) => {
	const hit = text.indexOf(entry.rendered, from)
	return hit === -1 ? null : [hit, hit + entry.rendered.length]
}

/** Strip each fill-map entry at its own fill site: the next untraced occurrence after the previous entry's site. */
function traceFills(owners, fillMap, fits, locate = plainSite) {
	const keys = [...owners.keys()]
	const texts = [...owners.values()]
	let [index, from] = [0, 0]
	for (const entry of fillMap ?? []) {
		const { rendered } = entry
		if (!rendered) continue
		for (let i = index, at = from; i < texts.length; i += 1, at = 0) {
			let hit = locate(entry, texts[i], at)
			const glued = ([start, end]) => (/^\d/.test(rendered) && /\d/.test(texts[i][start - 1] ?? "")) || (/\d$/.test(rendered) && /\d/.test(texts[i][end] ?? ""))
			while (hit && (glued(hit) || !fits(entry, texts[i].slice(hit[0])))) hit = locate(entry, texts[i], hit[0] + 1)
			if (!hit) continue
			texts[i] = `${texts[i].slice(0, hit[0])}${TRACED}${texts[i].slice(hit[1])}`
			;[index, from] = [i, hit[0] + TRACED.length]
			break
		}
	}
	return new Map(keys.map((key, i) => [key, texts[i]]))
}

/**
 * @param {object} ctx buildContext(...) from gates-static.mjs
 * @param {Map<object, unknown>} charts chart figures, whose numerals chart checks own
 * @param {{ fact_id: string, rendered: string, start?: number, end?: number }[] | null} fillMap Markdown fill map, or null
 * @param {(code: string, node: object, message: string) => void} flag
 * @param {(entry: object, tail: string) => boolean} fits whether the text from a candidate site on reads as the entry's row
 * @param {(entry: object, text: string, from: number) => [number, number] | null} [locate] the next candidate site of an entry's text
 */
export function traceChecks(ctx, charts, fillMap, flag, fits, locate) {
	for (const [owner, text] of traceFills(ownerTexts(ctx, charts), fillMap, fits, locate)) scanOwner(ctx, owner, text, flag)
}
