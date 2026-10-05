import { describe, expect, test } from "bun:test"

import {
	DEFECT_CODES,
	DELIVERABLE_FORMATS,
	DELIVERABLE_STATUSES,
	DESIGN_SPEC_SECTIONS,
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
	validateOutcomeManifest,
	validateRepairState,
} from "./contracts.mjs"

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
		gates: { static: "not_run", layout: "not_run", visual: "not_run", proofread: "not_run" },
		residualDefects: [],
		repair: null,
		sources: null,
	}
}

describe("DEFECT_CODES", () => {
	test("#given the code table #when every code is inspected #then it has a severity, a hint, and an integrity flag", () => {
		expect(Object.keys(DEFECT_CODES).sort()).toEqual([...STATIC_CODES_EXPECTED, "missing_promised_deliverable", ...LAYOUT_CODES_EXPECTED].sort())
		for (const [code, entry] of Object.entries(DEFECT_CODES)) {
			expect(SEVERITIES.has(entry.severity), `${code} severity`).toBe(true)
			expect(typeof entry.hint).toBe("string")
			expect(entry.hint.length).toBeGreaterThan(10)
			expect(typeof entry.integrity).toBe("boolean")
		}
	})

	test("#given the code table #when integrity codes are derived #then they are exactly the five blocker codes", () => {
		expect([...INTEGRITY_CODES].sort()).toEqual([
			"broken_asset_reference",
			"missing_citation_section",
			"missing_closing_section",
			"missing_promised_deliverable",
			"missing_required_section",
		])
		for (const code of INTEGRITY_CODES) expect(DEFECT_CODES[code].severity).toBe("blocker")
		for (const [code, entry] of Object.entries(DEFECT_CODES)) {
			if (entry.severity === "blocker") expect(INTEGRITY_CODES.has(code), `${code} must be integrity`).toBe(true)
		}
	})

	test("#given the frozen table #when a severity write is attempted #then it throws and the value is unchanged", () => {
		expect(Object.isFrozen(DEFECT_CODES)).toBe(true)
		expect(Object.isFrozen(DEFECT_CODES.korean_no_keep_all)).toBe(true)
		expect(() => {
			"use strict"
			DEFECT_CODES.korean_no_keep_all.severity = "minor"
		}).toThrow()
		expect(DEFECT_CODES.korean_no_keep_all.severity).toBe("major")
	})
})

describe("code groups", () => {
	test("#given the code groups #when unioned #then they partition the code table exactly", () => {
		expect([...STATIC_CODES].sort()).toEqual(STATIC_CODES_EXPECTED.slice().sort())
		expect([...LAYOUT_CODES].sort()).toEqual(LAYOUT_CODES_EXPECTED.slice().sort())
		expect([...MANIFEST_CODES]).toEqual(["missing_promised_deliverable"])
		const union = [...STATIC_CODES, ...LAYOUT_CODES, ...MANIFEST_CODES].sort()
		expect(union).toEqual(Object.keys(DEFECT_CODES).sort())
		expect(new Set(union).size).toBe(union.length)
		expect(Object.isFrozen(STATIC_CODES)).toBe(true)
	})
})

describe("enums", () => {
	test("#given the vocabulary #when read #then lanes, states, formats, statuses, gates, lineage modes are fixed lists", () => {
		expect(LANES).toEqual(["template-strict", "template-vibe", "no-format", "edit-existing"])
		expect(STATES).toEqual(["none", "partial", "complete"])
		expect(DELIVERABLE_FORMATS).toEqual(["pdf", "docx", "html", "md", "latex", "slides", "post"])
		expect(DELIVERABLE_STATUSES).toEqual(["pending", "delivered", "blocked_capability", "skipped", "failed"])
		expect(GATE_NAMES).toEqual(["static", "layout", "visual", "proofread"])
		expect(GATE_STATUSES).toEqual(["pass", "fail", "not_run"])
		expect(LINEAGE_MODES).toEqual(["inline", "section"])
		expect(DESIGN_SPEC_SECTIONS).toEqual([
			"Extracted from", "Tokens", "Typography", "Layout", "Structure", "Figures", "Citations", "Open questions",
		])
		expect(REPAIR_DEFAULTS).toEqual({ maxAttempts: 3, plateauLimit: 2, wallClockMs: 900_000 })
		expect(Object.isFrozen(LANES)).toBe(true)
		expect(Object.isFrozen(REPAIR_DEFAULTS)).toBe(true)
	})
})

describe("validateOutcomeManifest", () => {
	test("#given an empty object #when validated #then it fails naming schemaVersion", () => {
		const result = validateOutcomeManifest({})
		expect(result.ok).toBe(false)
		expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true)
	})

	test("#given a well-formed manifest #when validated #then it passes", () => {
		expect(validateOutcomeManifest(sampleManifest())).toEqual({ ok: true, errors: [] })
	})

	test("#given a deliverable with an unknown status #when validated #then the error names the row", () => {
		const m = sampleManifest()
		m.deliverables[0].status = "done"
		const result = validateOutcomeManifest(m)
		expect(result.ok).toBe(false)
		expect(result.errors.join("\n")).toMatch(/deliverables\[0\]\.status/)
	})

	test("#given a gate with an unknown value #when validated #then it fails", () => {
		const m = sampleManifest()
		m.gates.static = "ok"
		expect(validateOutcomeManifest(m).ok).toBe(false)
	})
})

describe("validateRepairState", () => {
	test("#given a well-formed state #when validated #then it passes, and a bad measure fails", () => {
		const good = {
			schemaVersion: SCHEMA_VERSION,
			startedAt: "2026-01-01T12:00:00.000Z",
			budget: { maxAttempts: 3, plateauLimit: 2, wallClockMs: 900_000 },
			attempts: [{ at: "2026-01-01T12:01:00.000Z", measure: [1, 2, 0], signature: "em_dash_in_prose|unsourced_number" }],
			consecutiveNonProgress: 0,
			seenSignatures: ["em_dash_in_prose|unsourced_number"],
		}
		expect(validateRepairState(good)).toEqual({ ok: true, errors: [] })
		const bad = { ...good, attempts: [{ at: "x", measure: [1, 2], signature: "" }] }
		expect(validateRepairState(bad).ok).toBe(false)
	})
})
