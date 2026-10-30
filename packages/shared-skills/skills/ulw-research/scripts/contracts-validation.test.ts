import { describe, expect, test } from "bun:test"

import { SCHEMA_VERSION, normalizeManifest, validateOutcomeManifest, validateRepairState } from "./contracts.mjs"

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

	test("#given a manifest written before the fidelity gate #when validated raw and after normalizeManifest #then only the normalized copy passes, with fidelity not_run", () => {
		const old = fourGateManifest()
		expect(validateOutcomeManifest(old).ok).toBe(false)
		const normalized = normalizeManifest(old)
		expect(normalized.gates.fidelity).toBe("not_run")
		expect(normalized.gates.static).toBe("not_run")
		expect(validateOutcomeManifest(normalized)).toEqual({ ok: true, errors: [] })
		expect(old.gates).not.toHaveProperty("fidelity")
		const failed = { ...old, gates: { ...old.gates, visual: "fail" } }
		expect(normalizeManifest(failed).gates.visual).toBe("fail")
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
