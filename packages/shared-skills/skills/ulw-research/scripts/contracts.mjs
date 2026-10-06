// contracts.mjs - the fixed vocabulary every report-tools module shares.
//
// Severities live here and nowhere else: no module exports a way to change them, so a
// content-integrity defect can never be demoted by a caller. Plain Node ESM, node: builtins
// only, runnable by `node` and `bun` alike.

export const SCHEMA_VERSION = 1

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
})

const LAYOUT_PREFIX = "layout_"
/** Codes checkStatic can raise (G1-G15). */
export const STATIC_CODES = Object.freeze(
	Object.keys(DEFECT_CODES).filter((code) => !code.startsWith(LAYOUT_PREFIX) && code !== "missing_promised_deliverable"),
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
export const GATE_NAMES = Object.freeze(["static", "layout", "visual", "proofread"])
export const GATE_STATUSES = Object.freeze(["pass", "fail", "not_run"])
export const LINEAGE_MODES = Object.freeze(["inline", "section"])
export const ANSWERED_BY = Object.freeze(["user", "default", "request"])
export const REPAIR_DEFAULTS = Object.freeze({ maxAttempts: 3, plateauLimit: 2, wallClockMs: 15 * 60 * 1000 })
export const DESIGN_SPEC_SECTIONS = Object.freeze([
	"Extracted from",
	"Tokens",
	"Typography",
	"Layout",
	"Structure",
	"Figures",
	"Citations",
	"Open questions",
])

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
	if (Array.isArray(manifest.residualDefects)) manifest.residualDefects.forEach((defect, index) => validateDefect(defect, `residualDefects[${index}]`, errors))
	else errors.push("residualDefects must be an array")
	check(errors, manifest.repair === null || isObject(manifest.repair), "repair must be null or an object")
	check(errors, manifest.sources === null || isObject(manifest.sources), "sources must be null or an object")
	return { ok: errors.length === 0, errors }
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
