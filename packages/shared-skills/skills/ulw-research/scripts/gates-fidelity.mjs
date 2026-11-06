// gates-fidelity.mjs - the deterministic fidelity gate over a filled HTML report.
//
// checkFidelity refuses to judge a report whose brief has no locked `## Fidelity` block (one
// fidelity_interview_incomplete defect). Otherwise it builds the static-gate document context
// once and runs the value, binding, and lexicon checks over it, returning defects in the shape
// `check` emits plus integrity, sorted blocker, major, minor, then line, selector, code. It never
// calls a model or reads the network; the meaning verifier consumes its pairs separately.
// Plain Node ESM, sibling imports only.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { DEFECT_CODES } from "./contracts.mjs"
import { bindingChecks, proseSentences } from "./fidelity-binding.mjs"
import { isLocked, parseFidelityBlock } from "./fidelity-brief.mjs"
import { lexiconChecks } from "./fidelity-lexicon.mjs"
import { valueChecks } from "./fidelity-values.mjs"
import { buildContext } from "./gates-static.mjs"
import { parseHtml } from "./html-lite.mjs"

/** Every code this gate can raise. */
export const FIDELITY_GATE_CODES = Object.freeze([
	"unit_unbound",
	"fidelity_interview_incomplete", "unresolved_placeholder", "value_mismatch", "unit_mismatch", "quote_not_verbatim",
	"quote_unbound", "claim_status_invalid", "snapshot_hash_mismatch", "chart_value_untraceable", "untraceable_number",
	"unsupported_verification", "conflicting_readings", "hedge_dropped", "direction_flipped", "causality_added",
	"qualifier_dropped", "unbound_sentence", "snapshot_mismatch", "operand_timestamp_missing", "operand_missing", "join_integrity_fail", "quote_stale_version",
	"quote_fuzzy_match", "name_outside_quote", "scope_widened_warn", "claim_kind_mismatch", "verification_claim_unmarked",
	"snapshot_not_raw", "relocated", "quote_converted_only",
])
const RANK = { blocker: 0, major: 1, minor: 2 }

/** The gate and delivery barrier share registry policy; caller severities cannot demote it. */
export function blocksDelivery(defect) {
	if (!Object.hasOwn(DEFECT_CODES, defect?.code)) return true
	const entry = DEFECT_CODES[defect.code]
	return entry.integrity || entry.severity !== "minor"
}

export function deliveryBlockReason(defect) {
	return Object.hasOwn(DEFECT_CODES, defect?.code) ? `fidelity_unresolved: ${defect.code}` : `unknown defect code ${defect?.code}`
}

function withIntegrity(defect) {
	const { code, severity, selector, line, message, hint, part, fact_id } = defect
	return { code, severity, integrity: DEFECT_CODES[code].integrity, selector, line, message, hint, ...(part ? { part } : {}), ...(fact_id ? { fact_id } : {}) }
}

function compareDefects(a, b) {
	const text = (x, y) => (x < y ? -1 : x > y ? 1 : 0)
	return RANK[a.severity] - RANK[b.severity] || (a.line ?? 0) - (b.line ?? 0) || text(a.selector ?? "", b.selector ?? "") || text(a.code, b.code)
}

function readAcronyms(sourcesDir, sourceId, cache) {
	if (!sourcesDir || !sourceId) return {}
	if (!cache.has(sourceId)) {
		const path = join(sourcesDir, sourceId, "acronyms.json")
		cache.set(sourceId, existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {})
	}
	return cache.get(sourceId)
}

/** One (row quote, report sentence) pair per fact cited in a prose sentence outside sources and toc. */
export function fidelityPairs(ctx, ledger, sourcesDir) {
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const cache = new Map()
	const pairs = []
	for (const block of proseSentences(ctx)) {
		if (block.kind === "sources" || block.kind === "toc") continue
		block.sentences.forEach((sentence, index) => {
			for (const fact of sentence.facts) {
				const row = rows.get(fact.id)
				if (!row?.quote) continue
				pairs.push({
					pair_id: `${fact.id}@${block.owner.line}:${index + 1}`,
					fact_id: fact.id,
					quote: row.quote,
					sentence: sentence.text,
					span: [fact.start - sentence.start, fact.end - sentence.start],
					qualifier: row.kind === "quote" ? null : row.qualifier,
					acronyms: readAcronyms(sourcesDir, row.source_id, cache),
					node: block.owner,
				})
			}
		})
	}
	return pairs
}

function incomplete(parsed) {
	const reasons = !parsed?.present ? "no ## Fidelity block" : [...(parsed.errors ?? []), ...parsed.missing.map((f) => `missing: ${f}`), ...parsed.pending.map((f) => `pending: ${f}`)].join("; ")
	const entry = DEFECT_CODES.fidelity_interview_incomplete
	return { code: "fidelity_interview_incomplete", severity: entry.severity, integrity: entry.integrity, selector: null, line: null, message: `fidelity interview incomplete (${reasons})`, hint: entry.hint }
}

/**
 * @param {string} html the filled report
 * @param {{ ledger: { rows: object[] }, sourcesDir?: string | null, claims?: object | null, fillMap?: object[] | null, fillEntries?: object[] | null,
 *   brief: string | object, baseDir?: string, recompute?: (ledger: object, row: object) => { ok: boolean } }} options
 *   `brief` is the brief.md text or parseFidelityBlock output; `baseDir` resolves data-chart-source paths.
 * @returns {{ defects: object[], gatesRun: string[] }}
 */
export function checkFidelity(html, { ledger, sourcesDir = null, claims = null, fillMap = null, fillEntries = null, brief, baseDir, recompute } = {}) {
	const parsed = brief && typeof brief === "object" ? brief : parseFidelityBlock(String(brief ?? ""))
	if (!isLocked(parsed)) return { defects: [incomplete(parsed)], gatesRun: ["fidelity_interview_incomplete"] }
	const ctx = buildContext(parseHtml(html), { baseDir })
	const defects = [
		...valueChecks(ctx, ledger, fillMap, sourcesDir, { recompute, asOf: parsed.fields["as of"], fillEntries }),
		...bindingChecks(ctx, claims, ledger),
	]
	const pairs = fidelityPairs(ctx, ledger, sourcesDir)
	const byId = new Map(pairs.map((pair) => [pair.pair_id, pair]))
	for (const finding of lexiconChecks(pairs).findings) defects.push(ctx.defect(finding.code, byId.get(finding.pair_id).node, `${finding.pair_id}: ${finding.message}`))
	return { defects: defects.map(withIntegrity).sort(compareDefects), gatesRun: [...FIDELITY_GATE_CODES] }
}
