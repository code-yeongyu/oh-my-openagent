// contracts.mjs - the fixed vocabulary every report-tools module shares.
//
// Severities live here and nowhere else: no module exports a way to change them, so a
// content-integrity defect can never be demoted by a caller. Plain Node ESM, node: builtins
// only, runnable by `node` and `bun` alike.

export const SCHEMA_VERSION = 1

/** The severity vocabulary in rank order; every DEFECT_CODES entry uses one of these. */
export const SEVERITIES = Object.freeze(["blocker", "major", "minor"])

/** Defect counts per severity, then total. */
export function countDefects(defects) {
	const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]))
	for (const defect of defects) counts[defect.severity] += 1
	return { ...counts, total: defects.length }
}

function deepFreeze(value) {
	if (value === null || typeof value !== "object") return value
	for (const key of Object.keys(value)) deepFreeze(value[key])
	return Object.freeze(value)
}

/** code -> { severity, integrity, hint }. integrity = blocks delivery even on repair exhaustion. */
export const DEFECT_CODES = deepFreeze({
	korean_no_keep_all: { severity: "major", integrity: false, hint: 'Add "word-break: keep-all; overflow-wrap: anywhere" to the body or the slide text container.' },
	palette_off_token: { severity: "minor", integrity: false, hint: "Replace the literal color with a design-spec token (var(--...)) or add the color to the spec palette." },
	emoji_in_prose: { severity: "major", integrity: false, hint: "Remove the emoji; use an inline SVG icon or plain text." },
	em_dash_in_prose: { severity: "major", integrity: false, hint: "Rewrite the sentence with a comma, colon, or period instead of an em dash." },
	en_dash_in_prose: { severity: "minor", integrity: false, hint: "Use a hyphen for compounds; keep the en dash only between numbers." },
	heading_too_long: { severity: "minor", integrity: false, hint: "Shorten the heading to one line (26 Korean characters or 12 English words)." },
	heading_generic: { severity: "minor", integrity: false, hint: "Make the heading carry the section's claim instead of a generic label." },
	unsourced_number: { severity: "major", integrity: false, hint: "Tag the number MEASURED / ASSUMED / DERIVED or cite its source in the same paragraph." },
	chart_without_figure: { severity: "major", integrity: false, hint: "Wrap the image or chart in a figure container with a caption." },
	chart_svg_no_text: { severity: "major", integrity: false, hint: "Give the chart a title, axis labels, units, and value labels as SVG text." },
	chart_svg_missing_labels: { severity: "minor", integrity: false, hint: "Add the missing title, axis ticks, or unit label to the chart." },
	report_without_visual: { severity: "major", integrity: false, hint: "Add at least one captioned visual of the findings: a chart from the data table, a rendered Mermaid diagram, or a figure image (references/report-visualization.md)." },
	image_missing_alt: { severity: "minor", integrity: false, hint: "Give the image an alt attribute that states what it shows, not its file name; mark a purely decorative image alt=\"\" with role=\"presentation\"." },
	korean_serif_font: { severity: "major", integrity: false, hint: "Use a gothic (sans) Korean family; serif and brush families are banned by the design spec." },
	section_without_citation: { severity: "major", integrity: false, hint: "Cite at least one source inside this section or merge it into a cited one." },
	missing_closing_section: { severity: "blocker", integrity: true, hint: "Add the closing section that explains how the report was made (method, sources, gates)." },
	missing_citation_section: { severity: "blocker", integrity: true, hint: "Add a sources or references section, or [S<n>] definition lines." },
	broken_asset_reference: { severity: "blocker", integrity: true, hint: "Re-render or restore the missing asset file before delivery." },
	missing_required_section: { severity: "blocker", integrity: true, hint: "Add the section the brief requires (matched by --require-section)." },
	missing_promised_deliverable: { severity: "blocker", integrity: true, hint: "Produce the promised deliverable or record it as blocked_capability or skipped with a reason." },
	layout_overflow: { severity: "major", integrity: false, hint: "Constrain the element to its container (max-width: 100%, overflow-wrap: anywhere, or a narrower measure)." },
	layout_text_clipped: { severity: "major", integrity: false, hint: "Remove the overflow: hidden clip or give the text room to wrap." },
	layout_scroll_container: { severity: "minor", integrity: false, hint: "Scrolling content prints clipped; make the content fit or wrap the table in a scroll wrapper only for HTML deliverables." },
	layout_image_distorted: { severity: "major", integrity: false, hint: "Preserve the image aspect ratio (object-fit: contain inside a fixed container)." },
	layout_sibling_overlap: { severity: "major", integrity: false, hint: "Separate the overlapping elements (margins, grid, or a slide split)." },
	unresolved_placeholder: { severity: "blocker", integrity: true, hint: "Register the fact with fact add or remove the sentence; a placeholder is never filled with a guess." },
	value_mismatch: { severity: "blocker", integrity: true, hint: "Re-run fact fill; never edit a filled value by hand." },
	unit_mismatch: { severity: "blocker", integrity: true, hint: "Re-run fact fill, or derive a converted row with fact derive --op convert." },
	quote_not_verbatim: { severity: "blocker", integrity: true, hint: "Re-insert the quote through its {{Q<n>}} placeholder; after a second failure the sentence is replaced by the quote." },
	claim_status_invalid: { severity: "blocker", integrity: true, hint: "The claim id is unknown, refuted, unresolved, or not in verified-claims; move the sentence to Gaps or Contradictions, or remove it." },
	incompatible_operands: { severity: "blocker", integrity: true, hint: "The operands differ in unit, population, period, or basis for this operation; fix the rows or declare the operation that fits." },
	pointer_label_mismatch: { severity: "blocker", integrity: true, hint: "The placeholder's label is not the row's label; check the id, then the label." },
	quote_anchor_unresolved: { severity: "blocker", integrity: true, hint: "A from or to anchor is missing or occurs more than once in the quote; pick unique anchor words." },
	unit_duplicated: { severity: "blocker", integrity: true, hint: "The unit after the placeholder repeats the row's unit; use :value or remove the unit." },
	polish_diff_fail: { severity: "blocker", integrity: true, hint: "The polish pass changed numbers, tickers, table rows, claim ids, markup, or hidden content; revert to the pre-polish artifact and apply the language fixes only." },
	fidelity_interview_incomplete: { severity: "blocker", integrity: true, hint: "A fidelity field is pending or missing in brief.md; answer the open question or record its default, then rerun." },
	derived_not_allowed: { severity: "blocker", integrity: true, hint: "The brief allows no derived or assumed numbers; cite a source row directly or change the brief with the requester." },
	source_outside_floor: { severity: "blocker", integrity: true, hint: "The row's source is outside the source floor the brief records; use a source the brief allows or remove the fact." },
	brief_changed: { severity: "blocker", integrity: true, hint: "The edition's fill map was not written under the current ## Fidelity block (it changed after fill, or the map predates the binding); re-run fact fill, then fact verify." },
	snapshot_hash_mismatch: { severity: "blocker", integrity: true, hint: "The source snapshot changed after it was pinned; re-snapshot the source and re-register its rows." },
	chart_value_untraceable: { severity: "blocker", integrity: true, hint: "A chart value, tick, or data file does not match its ledger-backed data source; re-render the chart from the exported data." },
	quote_unbound: { severity: "blocker", integrity: true, hint: "A direct quotation has no ledger quote row; register it with fact quote and insert it through its placeholder." },
	edition_unverified: { severity: "blocker", integrity: true, hint: "The delivered file has no matching fact verify record; run fact verify on that edition and record it with --verified-by." },
	untraceable_number: { severity: "major", integrity: false, hint: "Replace the typed number with a {{F<n>}} placeholder backed by a ledger row, or register it as assumed with a rationale." },
	unsupported_verification: { severity: "major", integrity: false, hint: "A sentence marked verified (data-claim-kind=\"verified\") cites a row that is not recorded command output; cite the recorded output row or drop the verified mark." },
	claim_kind_mismatch: { severity: "major", integrity: false, hint: "An element marked with a claim kind (data-claim-kind) cites a row that kind does not accept, or the kind is unknown; cite a row of that kind or fix the mark (references/fidelity-claim-kinds.md)." },
	conflicting_readings: { severity: "major", integrity: false, hint: "Two ledger rows with different periods or qualifiers are cited as one fact; split the sentence or retire one row." },
	hedge_dropped: { severity: "major", integrity: false, hint: "Restore the qualifier the source uses (estimated, about, not yet)." },
	direction_flipped: { severity: "major", integrity: false, hint: "The source states the opposite direction; rewrite from the quote." },
	causality_added: { severity: "major", integrity: false, hint: "The source states no cause; state the correlation or quote the source." },
	qualifier_dropped: { severity: "major", integrity: false, hint: "The source bounds this value (up to, at least, about); restore the qualifier or use :q." },
	unbound_sentence: { severity: "major", integrity: false, hint: "Bind the sentence to a fact, a quote, a citation, or a claim-graph node with data-claim." },
	meaning_drift_confirmed: { severity: "major", integrity: false, hint: "Two independent readers found the same drift; rewrite from the quote or dispute with a reason." },
	meaning_unverified: { severity: "major", integrity: false, hint: "No meaning reader judged this pair, or no strong reader judged a force_strong pair; run the missing reader on pairs.json and rerun fact meaning-check." },
	polish_edit_rejected: { severity: "major", integrity: false, hint: "The edit changed a number, a hedge, a qualifier, a link, or a claim id, or contained <, > or &; re-propose the language fix only, narrowed to the words around any entity or tag." },
	polish_hedging_decreased: { severity: "major", integrity: false, hint: "The polish pass removed qualifiers; restore them." },
	polish_text_churn: { severity: "major", integrity: false, hint: "More than half the text changed during polish; the pass composed instead of proofreading." },
	snapshot_mismatch: { severity: "major", integrity: false, hint: "The operands come from different collection windows; use rows from one window or state the windows separately." },
	join_integrity_fail: { severity: "major", integrity: false, hint: "A table row combines facts from different source observations; keep each row to one observation or split it." },
	quote_stale_version: { severity: "major", integrity: false, hint: "The quoted source revision differs from the revision the report targets; re-snapshot the target revision or date the quote." },
	quote_fuzzy_match: { severity: "minor", integrity: false, hint: "The source text is OCR-noisy; confirm the snapshot and prefer the raw document." },
	name_outside_quote: { severity: "minor", integrity: false, hint: "A name in the sentence is not in the cited quote; add the source or remove the name." },
	verification_claim_unmarked: { severity: "minor", integrity: false, hint: "The sentence reads as a check we ran but carries no verified mark; mark it {{V:F<n>:label}} on a recorded command-output row, or reword it." },
	scope_widened_warn: { severity: "minor", integrity: false, hint: "The sentence uses a broader scope word than the quote; confirm the scope or narrow it." },
	particle_unverified: { severity: "minor", integrity: false, hint: "The particle after this value could not be checked; read it aloud and fix it by hand if wrong." },
	fallback_without_entity: { severity: "minor", integrity: false, hint: "The replacement quote has no entity for attribution; set one on the row." },
	meaning_drift_warn: { severity: "minor", integrity: false, hint: "A separate reader found the sentence changes scope, subject, or certainty; rewrite from the quote." },
	polish_edit_unlocated: { severity: "minor", integrity: false, hint: "The edit's before-text was not found exactly once; re-propose against the current text." },
	polish_link_changed: { severity: "minor", integrity: false, hint: "A link was altered or removed during polish; restore it." },
	polish_name_changed: { severity: "minor", integrity: false, hint: "A proper noun changed during polish; restore it." },
})

/** Codes only the fidelity verifier raises (fact ledger, fill, verify, meaning, polish). */
export const FIDELITY_CODES = Object.freeze([
	"unresolved_placeholder", "value_mismatch", "unit_mismatch", "quote_not_verbatim", "claim_status_invalid",
	"incompatible_operands", "pointer_label_mismatch", "quote_anchor_unresolved", "unit_duplicated", "polish_diff_fail",
	"fidelity_interview_incomplete", "derived_not_allowed", "source_outside_floor", "brief_changed", "snapshot_hash_mismatch",
	"chart_value_untraceable", "quote_unbound", "edition_unverified", "untraceable_number", "unsupported_verification", "claim_kind_mismatch",
	"conflicting_readings", "hedge_dropped", "direction_flipped", "causality_added", "qualifier_dropped", "unbound_sentence",
	"meaning_drift_confirmed", "meaning_unverified", "polish_edit_rejected", "polish_hedging_decreased", "polish_text_churn", "snapshot_mismatch",
	"join_integrity_fail", "quote_stale_version", "quote_fuzzy_match", "name_outside_quote", "verification_claim_unmarked", "scope_widened_warn",
	"particle_unverified", "fallback_without_entity", "meaning_drift_warn", "polish_edit_unlocated", "polish_link_changed",
	"polish_name_changed",
])
const FIDELITY_SET = new Set(FIDELITY_CODES)

const LAYOUT_PREFIX = "layout_"
/** Codes checkStatic can raise (G1-G17). */
export const STATIC_CODES = Object.freeze(
	Object.keys(DEFECT_CODES).filter(
		(code) => !code.startsWith(LAYOUT_PREFIX) && code !== "missing_promised_deliverable" && !FIDELITY_SET.has(code),
	),
)
/** Codes checkLayout can raise (L1-L5). */
export const LAYOUT_CODES = Object.freeze(Object.keys(DEFECT_CODES).filter((code) => code.startsWith(LAYOUT_PREFIX)))
/** Codes only the outcome manifest verifier raises. */
export const MANIFEST_CODES = Object.freeze(["missing_promised_deliverable"])

export const INTEGRITY_CODES = Object.freeze(
	new Set(Object.entries(DEFECT_CODES).filter(([, entry]) => entry.integrity).map(([code]) => code)),
)

export const LANES = Object.freeze(["template-strict", "template-vibe", "no-format", "edit-existing"])
export const STATES = Object.freeze(["none", "partial", "complete"])
export const DELIVERABLE_FORMATS = Object.freeze(["pdf", "docx", "html", "md", "latex", "slides", "post"])
export const DELIVERABLE_STATUSES = Object.freeze(["pending", "delivered", "blocked_capability", "skipped", "failed"])
export const GATE_NAMES = Object.freeze(["static", "fidelity", "layout", "visual", "proofread"])
export const GATE_STATUSES = Object.freeze(["pass", "fail", "not_run"])
export const LINEAGE_MODES = Object.freeze(["inline", "section"])
export const ANSWERED_BY = Object.freeze(["user", "default", "request", "pending"])
export const REPAIR_DEFAULTS = Object.freeze({ maxAttempts: 3, plateauLimit: 2, wallClockMs: 15 * 60 * 1000 })
export const DESIGN_SPEC_SECTIONS = Object.freeze(["Extracted from", "Tokens", "Typography", "Layout", "Structure", "Figures", "Citations", "Open questions"])

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function check(errors, condition, message) {
	if (!condition) errors.push(message)
}

function validateDeliverable(row, index, errors) {
	const at = `deliverables[${index}]`
	if (!isObject(row)) return errors.push(`${at} must be an object`)
	check(errors, DELIVERABLE_FORMATS.includes(row.format), `${at}.format must be one of ${DELIVERABLE_FORMATS.join(", ")}`)
	check(errors, DELIVERABLE_STATUSES.includes(row.status), `${at}.status must be one of ${DELIVERABLE_STATUSES.join(", ")}`)
	check(errors, typeof row.promised === "boolean", `${at}.promised must be a boolean`)
	check(errors, typeof row.updatedAt === "string" && ISO_DATE.test(row.updatedAt), `${at}.updatedAt must be an ISO timestamp`)
	for (const key of ["path", "reason"]) {
		if (row[key] !== undefined) check(errors, typeof row[key] === "string", `${at}.${key} must be a string`)
	}
	for (const key of ["bytes", "pages"]) {
		if (row[key] !== undefined) check(errors, Number.isInteger(row[key]) && row[key] >= 0, `${at}.${key} must be a non-negative integer`)
	}
}

function validateDefect(defect, at, errors) {
	if (!isObject(defect)) return errors.push(`${at} must be an object`)
	check(errors, Object.hasOwn(DEFECT_CODES, defect.code), `${at}.code is not a known defect code`)
	check(errors, typeof defect.message === "string", `${at}.message must be a string`)
}

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateOutcomeManifest(manifest) {
	const errors = []
	if (!isObject(manifest)) return { ok: false, errors: ["manifest must be an object (schemaVersion missing)"] }
	check(errors, manifest.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`)
	check(errors, typeof manifest.sessionDir === "string" && manifest.sessionDir.length > 0, "sessionDir must be a non-empty string")
	check(errors, typeof manifest.startedAt === "string" && ISO_DATE.test(manifest.startedAt), "startedAt must be an ISO timestamp")
	check(errors, manifest.finishedAt === null || (typeof manifest.finishedAt === "string" && ISO_DATE.test(manifest.finishedAt)), "finishedAt must be null or an ISO timestamp")
	check(errors, manifest.elapsedMinutes === null || (Number.isFinite(manifest.elapsedMinutes) && manifest.elapsedMinutes >= 0), "elapsedMinutes must be null or a non-negative number")
	check(errors, manifest.lane === null || LANES.includes(manifest.lane), `lane must be null or one of ${LANES.join(", ")}`)
	check(errors, manifest.interview === null || isObject(manifest.interview), "interview must be null or an object")
	if (Array.isArray(manifest.deliverables)) manifest.deliverables.forEach((row, index) => validateDeliverable(row, index, errors))
	else errors.push("deliverables must be an array")
	if (Array.isArray(manifest.renders)) {
		manifest.renders.forEach((render, index) => {
			check(errors, isObject(render) && typeof render.path === "string" && Number.isInteger(render.page) && render.page >= 1, `renders[${index}] must be { path: string, page: integer >= 1 }`)
		})
	} else errors.push("renders must be an array")
	if (isObject(manifest.gates)) {
		for (const gate of GATE_NAMES) check(errors, GATE_STATUSES.includes(manifest.gates[gate]), `gates.${gate} must be one of ${GATE_STATUSES.join(", ")}`)
	} else errors.push("gates must be an object")
	if (manifest.gateHistory !== undefined) {
		if (!Array.isArray(manifest.gateHistory)) errors.push("gateHistory must be an array")
		else for (const entry of manifest.gateHistory) {
			check(errors, isObject(entry) && GATE_NAMES.includes(entry.gate) && GATE_STATUSES.includes(entry.status)
				&& typeof entry.at === "string" && ISO_DATE.test(entry.at)
				&& (entry.reason === undefined || typeof entry.reason === "string"), "gateHistory entries must have a known gate, status, timestamp, and optional reason")
		}
	}
	if (Array.isArray(manifest.residualDefects)) manifest.residualDefects.forEach((defect, index) => validateDefect(defect, `residualDefects[${index}]`, errors))
	else errors.push("residualDefects must be an array")
	check(errors, manifest.repair === null || isObject(manifest.repair), "repair must be null or an object")
	check(errors, manifest.sources === null || isObject(manifest.sources), "sources must be null or an object")
	return { ok: errors.length === 0, errors }
}

/** A copy of a manifest written before a gate existed: every absent gate key becomes not_run. */
export function normalizeManifest(manifest) {
	if (!isObject(manifest) || !isObject(manifest.gates)) return manifest
	const gates = { ...manifest.gates }
	for (const gate of GATE_NAMES) if (!Object.hasOwn(gates, gate)) gates[gate] = "not_run"
	return { ...manifest, gates }
}

function isMeasure(value) {
	return Array.isArray(value) && value.length === 3 && value.every((n) => Number.isInteger(n) && n >= 0)
}

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateRepairState(state) {
	const errors = []
	if (!isObject(state)) return { ok: false, errors: ["repair state must be an object (schemaVersion missing)"] }
	check(errors, state.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`)
	check(errors, typeof state.startedAt === "string" && ISO_DATE.test(state.startedAt), "startedAt must be an ISO timestamp")
	if (isObject(state.budget)) {
		for (const key of ["maxAttempts", "plateauLimit", "wallClockMs"]) {
			check(errors, Number.isInteger(state.budget[key]) && state.budget[key] > 0, `budget.${key} must be a positive integer`)
		}
	} else errors.push("budget must be an object")
	if (Array.isArray(state.attempts)) {
		state.attempts.forEach((attempt, index) => {
			const at = `attempts[${index}]`
			if (!isObject(attempt)) return errors.push(`${at} must be an object`)
			check(errors, typeof attempt.at === "string" && ISO_DATE.test(attempt.at), `${at}.at must be an ISO timestamp`)
			check(errors, isMeasure(attempt.measure), `${at}.measure must be [blocker, major, minor] counts`)
			check(errors, typeof attempt.signature === "string", `${at}.signature must be a string`)
		})
	} else errors.push("attempts must be an array")
	check(errors, Number.isInteger(state.consecutiveNonProgress) && state.consecutiveNonProgress >= 0, "consecutiveNonProgress must be a non-negative integer")
	check(errors, Array.isArray(state.seenSignatures) && state.seenSignatures.every((s) => typeof s === "string"), "seenSignatures must be an array of strings")
	return { ok: errors.length === 0, errors }
}
