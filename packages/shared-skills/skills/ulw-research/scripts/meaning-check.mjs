// meaning-check.mjs - ingest the meaning readers' verdicts over fact-pairs output.
//
// ingestVerdicts reads verdict files written by separate reader lanes (cheap and strong tiers),
// keeps a drift verdict only when its pair exists, its tier and drift_kind are in the closed sets,
// and both its fragment (from the sentence) and source_fragment (from the quote or statement) are
// non-empty substrings after whitespace normalization; every other verdict is dropped and logged.
// Both tiers naming the same drift_kind (not "other") on a pair is meaning_drift_confirmed (major,
// never integrity); one tier is meaning_drift_warn (minor). Each flagged pair yields one
// calibration line; a dispute is recorded there and never removes the defect. Coverage is
// fail-closed: every pair no reader judged, and every force_strong pair no strong reader judged,
// is listed in `unverified`, so a gate can tell a clean check apart from a pair nobody read.
// No model, no fetch.

import { appendFileSync, readFileSync } from "node:fs"

import { DEFECT_CODES } from "./contracts.mjs"

export const DRIFT_KINDS = Object.freeze([
	"subject_changed", "scope_widened", "hedge_dropped", "certainty_added", "causality_added",
	"direction_flipped", "population_changed", "evidence_grade_raised", "other",
])
export const MODEL_TIERS = Object.freeze(["cheap", "strong"])
export const VERDICTS = Object.freeze(["drift", "ok"])
export const isDriftKind = (kind) => DRIFT_KINDS.includes(kind)
/** The machine-read verdict contract a reader lane receives with pairs.json; built from the registries above. */
export const VERDICT_SCHEMA = Object.freeze({
	model_tier: MODEL_TIERS,
	verdict: VERDICTS,
	drift_kind: DRIFT_KINDS,
	required: Object.freeze(["pair_id", "verdict"]),
	drift_required: Object.freeze(["drift_kind", "fragment", "source_fragment"]),
})

/** NFC, every whitespace run collapsed to one space, trimmed. */
const squash = (text) => String(text ?? "").normalize("NFC").replace(/\s+/gu, " ").trim()

/** Read a verdict file, mapping an unreadable path or invalid JSON to a short typed error. */
function parseFile(path) {
	let text
	try {
		text = readFileSync(path, "utf8")
	} catch {
		throw new TypeError(`${path}: cannot read the verdict file`)
	}
	try {
		return JSON.parse(text)
	} catch {
		throw new TypeError(`${path}: the verdict file is not valid JSON`)
	}
}

function verdictsOf(input) {
	const label = typeof input === "string" ? input : "<inline>"
	const parsed = typeof input === "string" ? parseFile(input) : input
	const list = Array.isArray(parsed) ? parsed : parsed?.verdicts
	if (!Array.isArray(list)) throw new TypeError(`${label}: a verdict file is an array of verdicts or { verdicts: [...] }`)
	const tier = Array.isArray(parsed) ? undefined : parsed.model_tier
	return list.map((verdict) => ({ verdict: tier === undefined || verdict?.model_tier !== undefined ? verdict : { ...verdict, model_tier: tier }, file: label }))
}

/** The reason a verdict is dropped, or null when it is accepted. */
function dropReason(verdict, pair) {
	if (verdict === null || typeof verdict !== "object") return "malformed_verdict"
	if (!pair) return "unknown_pair"
	if (!VERDICTS.includes(verdict.verdict)) return "invalid_verdict"
	if (!MODEL_TIERS.includes(verdict.model_tier)) return "invalid_model_tier"
	if (verdict.verdict === "ok") return null
	if (!isDriftKind(verdict.drift_kind)) return "unknown_drift_kind"
	const [fragment, sourceFragment] = [squash(verdict.fragment), squash(verdict.source_fragment)]
	if (fragment === "" || sourceFragment === "") return "empty_fragment"
	if (!squash(pair.sentence).includes(fragment)) return "fragment_not_found"
	const source = pair.kind === "claim" ? pair.statement : pair.quote
	if (!squash(source).includes(sourceFragment)) return "source_fragment_not_found"
	return null
}

function defect(code, pair, driftKind, tiers, verdicts) {
	const entry = DEFECT_CODES[code]
	// The fragment must come from the verdict whose drift_kind is being reported, not from whichever
	// verdict happened to arrive first on the pair.
	const first = verdicts.find((verdict) => verdict.drift_kind === driftKind) ?? verdicts[0]
	return {
		code,
		severity: entry.severity,
		integrity: entry.integrity,
		pair_id: pair.pair_id,
		sentence_key: pair.sentence_key ?? null,
		drift_kind: driftKind,
		tiers,
		fragment: first.fragment,
		source_fragment: first.source_fragment,
		selector: null,
		line: null,
		message: `${pair.pair_id}: ${tiers.join(" and ")} reader${tiers.length > 1 ? "s" : ""} found ${driftKind} at "${squash(first.fragment)}"`,
		hint: entry.hint,
	}
}

/** One meaning_unverified defect per coverage gap, so blocksDelivery sees an unread pair through the registry. */
export function unverifiedDefects(unverified) {
	const entry = DEFECT_CODES.meaning_unverified
	return unverified.map((gap) => ({
		code: "meaning_unverified",
		severity: entry.severity,
		integrity: entry.integrity,
		pair_id: gap.pair_id,
		reason: gap.reason,
		selector: null,
		line: null,
		message: `${gap.pair_id}: ${gap.reason === "no_strong_verdict" ? "no strong reader judged this force_strong pair" : "no reader judged this pair"}`,
		hint: entry.hint,
	}))
}

/** Pairs with no accepted verdict, and force_strong pairs with no accepted strong verdict, in pair order. */
function coverageGaps(list, accepted) {
	const tiersByPair = new Map()
	for (const verdict of accepted) {
		tiersByPair.set(verdict.pair_id, (tiersByPair.get(verdict.pair_id) ?? new Set()).add(verdict.model_tier))
	}
	const gaps = []
	for (const pair of list) {
		const tiers = tiersByPair.get(pair.pair_id)
		if (tiers === undefined || tiers.size === 0) gaps.push({ pair_id: pair.pair_id, reason: "no_verdict" })
		else if (pair.force_strong === true && !tiers.has("strong")) gaps.push({ pair_id: pair.pair_id, reason: "no_strong_verdict" })
	}
	return gaps
}

/** Group accepted drift verdicts per pair, then per tier. */
function flaggedPairs(accepted) {
	const byPair = new Map()
	for (const verdict of accepted) {
		if (verdict.verdict !== "drift") continue
		const tiers = byPair.get(verdict.pair_id) ?? new Map()
		tiers.set(verdict.model_tier, [...(tiers.get(verdict.model_tier) ?? []), verdict])
		byPair.set(verdict.pair_id, tiers)
	}
	return byPair
}

/** The drift_kind both tiers named (never "other"), or null. */
function agreedKind(tiers) {
	const [cheap, strong] = MODEL_TIERS.map((tier) => tiers.get(tier) ?? [])
	return cheap.map((verdict) => verdict.drift_kind).find((kind) => kind !== "other" && strong.some((verdict) => verdict.drift_kind === kind)) ?? null
}

/**
 * @param {object[] | { pairs: object[] }} pairs extractPairs(...) output
 * @param {(string | object[] | { verdicts: object[], model_tier?: string })[]} verdictFiles paths, or parsed verdict lists
 * @param {{ dispute?: { pair_id: string, reason: string }, calibrationPath?: string }} [options]
 *   calibrationPath: append each calibration line to this JSONL file (fidelity-calibration.jsonl)
 * @returns {{ defects: object[], dropped: object[], unverified: { pair_id: string, reason: string }[], calibrationLines: string[] }}
 *   unverified lists, in pair order, every pair no reader judged (`no_verdict`) and every
 *   force_strong pair no strong reader judged (`no_strong_verdict`); a verdict that was dropped
 *   does not count as read. A consumer MUST treat a non-empty list as blocking: the pairs were
 *   never checked, so an empty `defects` list does not mean the report is clean.
 * @throws {TypeError} when pairs is neither an array nor `{ pairs: [...] }` (fail closed: a missing
 *   pairs input never reads as a fully verified report)
 */
export function ingestVerdicts(pairs, verdictFiles, options = {}) {
	const list = Array.isArray(pairs) ? pairs : pairs?.pairs
	if (!Array.isArray(list)) throw new TypeError("pairs: expected an array of pairs or { pairs: [...] }")
	const byId = new Map(list.map((pair) => [pair.pair_id, pair]))
	const accepted = []
	const dropped = []
	for (const input of verdictFiles) {
		for (const { verdict, file } of verdictsOf(input)) {
			const reason = dropReason(verdict, byId.get(verdict?.pair_id))
			if (reason === null) accepted.push(verdict)
			else dropped.push({ file, pair_id: verdict?.pair_id ?? null, model_tier: verdict?.model_tier ?? null, reason })
		}
	}
	const dispute = options.dispute ?? null
	const defects = []
	const calibrationLines = []
	const flagged = flaggedPairs(accepted)
	for (const pair of list) {
		const tiers = flagged.get(pair.pair_id)
		if (!tiers) continue
		const tierNames = MODEL_TIERS.filter((tier) => tiers.has(tier))
		const agreed = agreedKind(tiers)
		const verdicts = MODEL_TIERS.flatMap((tier) => tiers.get(tier) ?? [])
		const kind = agreed ?? verdicts[0].drift_kind
		const confirmed = agreed !== null
		defects.push(defect(confirmed ? "meaning_drift_confirmed" : "meaning_drift_warn", pair, kind, tierNames, verdicts))
		const disputed = dispute !== null && dispute.pair_id === pair.pair_id
		calibrationLines.push(JSON.stringify({ kind: pair.kind, pair_id: pair.pair_id, tiers: tierNames, drift_kind: kind, confirmed, disputed, reason: disputed ? String(dispute.reason ?? "") : null }))
	}
	const unverified = coverageGaps(list, accepted)
	if (dispute !== null && !flagged.has(dispute.pair_id)) {
		dropped.push({ file: "<dispute>", pair_id: dispute.pair_id, model_tier: null, reason: "dispute_not_flagged" })
	}
	if (options.calibrationPath && calibrationLines.length > 0) appendFileSync(options.calibrationPath, `${calibrationLines.join("\n")}\n`)
	return { defects, dropped, unverified, calibrationLines }
}
