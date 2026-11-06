// fidelity-claims.mjs - the claim-kind checks of the deterministic fidelity gate.
//
// A mark (the data-claim-kind attribute) binds per cited fact: a data-fact element takes the kind
// of its nearest mark (its own, else the closest marked ancestor), and only that kind is checked
// against its ledger row (claim-kinds.mjs CLAIM_KINDS); a row that fails is the kind's defect
// (unsupported_verification for `verified`). A fact under two marks of different kinds is a
// claim_kind_mismatch, and a mark that owns no fact of its own kind (every fact under it cites
// nothing or is shadowed by another kind) is its kind's defect: shadowing never satisfies a parent.
// An unmarked fact citing a row neither fact nor quote accepts (an assumed row) is a
// claim_kind_mismatch naming the mark it needs. A sentence that matches a kind's unmarked patterns warns (minor, verification_claim_unmarked)
// unless every fact it cites is marked that kind; a sentence citing no fact warns unless its block
// is marked. No model, no network.

import { CLAIM_ATTRIBUTE, CLAIM_KINDS, claimSatisfied, unmarkedKinds, unmarkedRequires } from "./claim-kinds.mjs"
import { proseSentences } from "./fidelity-binding.mjs"
import { clip } from "./fidelity-trace.mjs"
import { isClaimSegment } from "./sources-citation.mjs"
import { proseText } from "./html-lite.mjs"

const marked = (node) => node.attrs?.[CLAIM_ATTRIBUTE] !== undefined
const kindOf = (node) => node.attrs[CLAIM_ATTRIBUTE].trim()
const isFact = (node) => node.attrs["data-fact"] !== undefined

/** The marks over a node, nearest first: its own mark, then each marked ancestor. */
function marksOver(node) {
	const marks = []
	for (let cur = node; cur; cur = cur.parent) if (marked(cur)) marks.push(cur)
	return marks
}

const nearestKind = (node) => {
	const [mark] = marksOver(node)
	return mark ? kindOf(mark) : null
}

/** Whether `mark` binds `fact`: every mark from the fact up to `mark` names the same kind. */
function binds(mark, fact) {
	const marks = marksOver(fact)
	const at = marks.indexOf(mark)
	return at >= 0 && marks.slice(0, at + 1).every((cur) => kindOf(cur) === kindOf(mark))
}

/**
 * @param {object} ctx buildContext(...) from gates-static.mjs
 * @param {Map<string, object>} rows ledger rows by fact_id
 * @param {(row: object) => string | undefined} provenanceOf meta.json kind of the snapshot holding the row's own locator artifact
 * @param {(code: string, node: object, message: string) => void} flag
 */
export function claimChecks(ctx, rows, provenanceOf, flag) {
	for (const node of ctx.all.filter(marked)) {
		const name = kindOf(node)
		const entry = CLAIM_KINDS[name]
		if (!entry) {
			flag("claim_kind_mismatch", node, `${CLAIM_ATTRIBUTE}="${name}" is not a claim kind (${Object.keys(CLAIM_KINDS).join(", ")})`)
			continue
		}
		const cited = [node, ...ctx.util.descendants(node)].filter(isFact)
		if (cited.some((fact) => binds(node, fact))) continue
		const why = cited.length === 0 ? "cites no fact" : "cites no fact of its own (a nested mark of another kind never satisfies it)"
		flag(entry.defect, node, `"${clip(proseText(node))}" is marked ${name} but ${why}`)
	}
	for (const fact of ctx.all.filter(isFact)) {
		const [nearest, ...outer] = marksOver(fact)
		const id = fact.attrs["data-fact"]
		if (!nearest) {
			const need = unmarkedRequires(rows.get(id))
			const mark = need && `{{${CLAIM_KINDS[need].prefix}:${id}:${rows.get(id).label}}} (${CLAIM_ATTRIBUTE}="${need}")`
			if (need) flag("claim_kind_mismatch", fact, `${id} is a ${rows.get(id).kind} row cited with no mark; an unmarked numeral reads as a fact, so mark it ${mark}`)
			continue
		}
		const name = kindOf(nearest)
		const conflict = outer.find((mark) => kindOf(mark) !== name)
		if (conflict) flag("claim_kind_mismatch", fact, `${id} is marked ${name} inside a ${kindOf(conflict)} mark; a fact carries one claim kind`)
		const entry = CLAIM_KINDS[name]
		const row = rows.get(id)
		if (!entry || !row || claimSatisfied(name, row, provenanceOf(row))) continue
		const source = entry.sourceKinds ? ` and not one whose own locator artifact sits in a ${entry.sourceKinds.join(" or ")} snapshot` : ""
		flag(entry.defect, fact, `${row.fact_id} is marked ${name}, but it is a ${row.kind} row${source}`)
	}
	for (const block of proseSentences(ctx)) {
		if (block.kind === "toc") continue
		for (const sentence of block.kind === "sources" ? block.sentences.filter((s) => isClaimSegment(s.text)) : block.sentences) {
			for (const name of unmarkedKinds(sentence.text)) {
				const covered = sentence.facts.length > 0 ? sentence.facts.every((fact) => nearestKind(fact.node) === name) : nearestKind(block.owner) === name
				if (covered) continue
				flag(CLAIM_KINDS[name].unmarked.code, block.owner, `"${clip(sentence.text)}" reads as a ${name} claim but cites a fact with no ${CLAIM_ATTRIBUTE}="${name}" mark`)
			}
		}
	}
}
