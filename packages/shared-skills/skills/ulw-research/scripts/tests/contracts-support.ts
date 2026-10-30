import { describe, expect, test } from "bun:test"
import {
	ANSWERED_BY,
	DEFECT_CODES,
	DELIVERABLE_FORMATS,
	DELIVERABLE_STATUSES,
	DESIGN_SPEC_SECTIONS,
	FIDELITY_CODES,
	GATE_NAMES,
	GATE_STATUSES,
	INTEGRITY_CODES,
	LANES,
	LAYOUT_CODES,
	LINEAGE_MODES,
	MANIFEST_CODES,
	REPAIR_DEFAULTS,
	SCHEMA_VERSION,
	STATES,
	STATIC_CODES,
	normalizeManifest,
	validateOutcomeManifest,
	validateRepairState,
} from "../contracts.mjs"


const SEVERITIES = new Set(["blocker", "major", "minor"])

const STATIC_CODES_EXPECTED = [
	"korean_no_keep_all",
	"palette_off_token",
	"emoji_in_prose",
	"em_dash_in_prose",
	"en_dash_in_prose",
	"heading_too_long",
	"heading_generic",
	"unsourced_number",
	"chart_without_figure",
	"chart_svg_no_text",
	"chart_svg_missing_labels",
	"report_without_visual",
	"image_missing_alt",
	"korean_serif_font",
	"section_without_citation",
	"missing_closing_section",
	"missing_citation_section",
	"broken_asset_reference",
	"missing_required_section",
]

const LAYOUT_CODES_EXPECTED = [
	"layout_overflow",
	"layout_text_clipped",
	"layout_scroll_container",
	"layout_image_distorted",
	"layout_sibling_overlap",
]

// Fidelity vocabulary contract (#11009): severity and integrity per code are fixed here.
const FIDELITY_BLOCKERS = [
	"unresolved_placeholder",
	"value_mismatch",
	"unit_mismatch",
	"quote_not_verbatim",
	"claim_status_invalid",
	"incompatible_operands",
	"pointer_label_mismatch",
	"quote_anchor_unresolved",
	"unit_duplicated",
	"polish_diff_fail",
	"fidelity_interview_incomplete",
	"derived_not_allowed",
	"source_outside_floor",
	"brief_changed",
	"snapshot_hash_mismatch",
	"chart_value_untraceable",
	"quote_unbound",
	"edition_unverified",
	"snapshot_not_raw",
]

const FIDELITY_MAJORS = [
	"untraceable_number",
	"unsupported_verification",
	"claim_kind_mismatch",
	"conflicting_readings",
	"hedge_dropped",
	"direction_flipped",
	"causality_added",
	"qualifier_dropped",
	"unbound_sentence",
	"meaning_drift_confirmed",
	"meaning_unverified",
	"polish_edit_rejected",
	"polish_hedging_decreased",
	"polish_text_churn",
	"snapshot_mismatch",
	"join_integrity_fail",
	"quote_stale_version",
	"operand_timestamp_missing",
	"operand_missing",
]

const FIDELITY_MINORS = [
	"quote_fuzzy_match",
	"name_outside_quote",
	"verification_claim_unmarked",
	"scope_widened_warn",
	"particle_unverified",
	"fallback_without_entity",
	"meaning_drift_warn",
	"polish_edit_unlocated",
	"polish_link_changed",
	"polish_name_changed",
	"relocated",
	"quote_converted_only",
]

const FIDELITY_CODES_EXPECTED = [...FIDELITY_BLOCKERS, ...FIDELITY_MAJORS, ...FIDELITY_MINORS]


function fourGateManifest() {
	const manifest = sampleManifest()
	const { fidelity: _dropped, ...gates } = manifest.gates
	return { ...manifest, gates }
}


function sampleManifest() {
	return {
		schemaVersion: SCHEMA_VERSION,
		sessionDir: "/tmp/session/20260101-120000",
		startedAt: "2026-01-01T12:00:00.000Z",
		finishedAt: null,
		elapsedMinutes: null,
		lane: "no-format",
		interview: null,
		deliverables: [
			{ format: "pdf", status: "pending", promised: true, updatedAt: "2026-01-01T12:00:00.000Z" },
		],
		renders: [],
		gates: { static: "not_run", fidelity: "not_run", layout: "not_run", visual: "not_run", proofread: "not_run" },
		residualDefects: [],
		repair: null,
		sources: null,
	}
}
export { SEVERITIES, STATIC_CODES_EXPECTED, LAYOUT_CODES_EXPECTED, FIDELITY_BLOCKERS, FIDELITY_MAJORS, FIDELITY_MINORS, FIDELITY_CODES_EXPECTED, fourGateManifest, sampleManifest }
