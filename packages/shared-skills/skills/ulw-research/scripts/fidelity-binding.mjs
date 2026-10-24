// fidelity-binding.mjs - sentence binding and claim-status checks of the fidelity gate.
//
// proseSentences walks every leaf prose element (p, li) outside figures, tables and page chrome,
// keeps the offsets of each data-fact element inside its text, and splits it into sentences, so
// every check sees which ledger rows a sentence cites. bindingChecks raises unbound_sentence (a
// findings sentence with no fact, placeholder, citation, or data-claim), claim_status_invalid (a
// data-claim id that is unknown, refuted or unresolved outside a Gaps or Contradictions section,
// or high-risk and missing from verified-claims), and conflicting_readings (two active rows with
// one value and unit but different periods or qualifiers cited in one sentence). Plain Node ESM.

import { proseText } from "./html-lite.mjs"
import { fromDecimal, eq } from "./rational.mjs"
import { splitSentences } from "./sentence-split.mjs"
import { normalizeUnit } from "./units.mjs"

const SKIP = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "template", "noscript"])
const CONTAINERS = new Set(["figure", "table", "nav", "header", "footer"])
/** data-kind values whose sentences need no binding (opinion and recommendation blocks). */
export const EXEMPT_KINDS = Object.freeze(["opinion", "recommendation"])
export const isExemptKind = (kind) => EXEMPT_KINDS.includes(kind)
const DECIMAL = /^-?\d+(?:\.\d+)?$/
/** Gaps and Contradictions headings (English, and the Korean gap/limit/contradiction/conflict words). */
const GAPS_HEADING = /\b(?:gaps?|contradictions?|unresolved)\b|\uACF5\uBC31|\uD55C\uACC4|\uBAA8\uC21C|\uC0C1\uCDA9/i

/** Canonical unit token, or the raw unit without spaces, lowercased; "" for none. */
export function unitKey(unit) {
	if (unit === null || unit === undefined) return ""
	return normalizeUnit(String(unit)) ?? String(unit).replace(/\s+/g, "").toLowerCase()
}

/** Exact decimal equality; false when either side is not a plain decimal. */
export function sameValue(a, b) {
	const [x, y] = [String(a ?? "").replace(/,/g, ""), String(b ?? "").replace(/,/g, "")]
	return DECIMAL.test(x) && DECIMAL.test(y) && eq(fromDecimal(x), fromDecimal(y))
}

function serialize(node, out) {
	for (const child of node.children) {
		if (child.tag === "#text") out.text += child.text
		else if (child.tag === "br") out.text += " "
		else if (SKIP.has(child.tag)) continue
		else if (child.attrs["data-fact"] !== undefined) {
			const text = proseText(child)
			out.facts.push({ id: child.attrs["data-fact"], start: out.text.length, end: out.text.length + text.length, text, node: child })
			out.text += text
		} else serialize(child, out)
	}
	return out
}

/**
 * Leaf prose elements with their sentences and the facts each sentence cites.
 * @returns {{ owner: object, scope: object, kind: string|null, sentences: { text: string, start: number, end: number, facts: object[] }[] }[]}
 */
export function proseSentences(ctx) {
	const { closest, descendants } = ctx.util
	const blocks = []
	for (const { node, scope } of ctx.elements) {
		if (node.tag !== "p" && node.tag !== "li") continue
		if (node.tag === "li" && descendants(node).some((child) => child.tag === "p" || child.tag === "li")) continue
		if (closest(node, (cur) => CONTAINERS.has(cur.tag))) continue
		const { text, facts } = serialize(node, { text: "", facts: [] })
		const sentences = splitSentences(text).map((s) => ({ ...s, facts: facts.filter((f) => f.start < s.end && f.end > s.start) }))
		blocks.push({ owner: node, scope, kind: ctx.kindOf(scope), sentences })
	}
	return blocks
}

function claimList(claims) {
	const list = Array.isArray(claims) ? claims : (claims?.claims ?? [])
	return new Map(list.map((claim) => [claim.claim_id, claim]))
}

const selfOrUp = (ctx, node, test) => test(node) || Boolean(ctx.util.closest(node, test))

function claimDefects(ctx, claims) {
	const byId = claimList(claims)
	const out = []
	for (const { node, scope } of ctx.elements) {
		const attr = node.attrs["data-claim"]
		if (attr === undefined) continue
		const heading = scope.section?.heading
		const inGaps = Boolean(heading) && GAPS_HEADING.test(proseText(heading))
		for (const id of attr.split(/[\s,]+/).filter(Boolean)) {
			const claim = byId.get(id)
			let why = null
			if (!claim) why = `data-claim ${id} is not in the claim index`
			else if (/refuted|unresolved/i.test(claim.status) && !inGaps) why = `claim ${id} is ${claim.status} but asserted outside Gaps or Contradictions`
			else if (!inGaps && /high/i.test(claim.risk) && !claim.in_verified) why = `high-risk claim ${id} is not in verified-claims`
			if (why) out.push(ctx.defect("claim_status_invalid", node, why))
		}
	}
	return out
}

function conflict(rows, facts) {
	const cited = [...new Set(facts.map((f) => f.id))].map((id) => rows.get(id)).filter((row) => row && row.status === "active" && row.kind !== "quote")
	for (let i = 0; i < cited.length; i++) {
		for (let k = i + 1; k < cited.length; k++) {
			const [a, b] = [cited[i], cited[k]]
			if (!sameValue(a.value, b.value) || unitKey(a.unit) !== unitKey(b.unit)) continue
			if (a.valid_at !== b.valid_at || a.qualifier !== b.qualifier) return [a, b]
		}
	}
	return null
}

/**
 * @param {object} ctx buildContext(...) from gates-static.mjs
 * @param {{ claims: object[] } | object[] | null} claims indexClaims(...) output or its claims array
 * @param {{ rows: object[] } | null} ledger
 */
export function bindingChecks(ctx, claims, ledger) {
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const out = []
	for (const block of proseSentences(ctx)) {
		const findings = Boolean(block.scope.section) && block.kind === null
		const exempt = selfOrUp(ctx, block.owner, (cur) => isExemptKind(cur.attrs["data-kind"]) || cur.attrs["data-claim"] !== undefined)
		for (const sentence of block.sentences) {
			const bound = sentence.facts.length > 0 || ctx.util.citationMarker.test(sentence.text) || sentence.text.includes("{{")
			if (findings && !exempt && !bound) out.push(ctx.defect("unbound_sentence", block.owner, `no fact, citation, or data-claim binds: "${sentence.text.slice(0, 80)}"`))
			const pair = conflict(rows, sentence.facts)
			if (pair) {
				const [a, b] = pair
				out.push(ctx.defect("conflicting_readings", block.owner, `${a.fact_id} (${a.valid_at ?? "no period"}) and ${b.fact_id} (${b.valid_at ?? "no period"}) share ${a.value} ${a.unit ?? ""} in one sentence`))
			}
		}
	}
	return [...out, ...claimDefects(ctx, claims)]
}
