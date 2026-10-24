import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DRIFT_KINDS, ingestVerdicts } from "./meaning-check.mjs"

type Verdict = Record<string, unknown>
type Result = {
	defects: { code: string; severity: string; integrity: boolean; pair_id: string; drift_kind: string; fragment: string; source_fragment: string }[]
	dropped: { pair_id: string | null; reason: string; model_tier: string | null; file: string }[]
	unverified: { pair_id: string; reason: string }[]
	calibrationLines: string[]
}

const PAIRS = [
	{ pair_id: "P1", kind: "quote", sentence_key: "findings#Q1", fact_ids: ["Q1"], quote: "The pilot covered North America.", sentence: "The rollout was worldwide.", force_strong: true },
	{ pair_id: "P2", kind: "claim", claim_id: "C2", statement: "Revenue may grow in 2026.", sentence: "Revenue will grow in 2026.", force_strong: true },
]

const base = (tier: string, extra: Verdict = {}): Verdict => ({
	pair_id: "P1",
	verdict: "drift",
	drift_kind: "scope_widened",
	fragment: "worldwide",
	source_fragment: "North America",
	explanation: "The assertion broadens the reported region.",
	model_tier: tier,
	...extra,
})

let dir = ""
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "meaning-check-"))
})
afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function file(name: string, verdicts: Verdict[]): string {
	const path = join(dir, name)
	writeFileSync(path, JSON.stringify(verdicts))
	return path
}

function run(cheap: Verdict[], strong: Verdict[] = [], options: object = {}): Result {
	return ingestVerdicts(PAIRS, [file("cheap.json", cheap), file("strong.json", strong)], options) as Result
}

describe("ingestVerdicts: tier agreement", () => {
	test("#given cheap and strong agree on scope_widened #when ingested #then meaning_drift_confirmed (major, non-integrity)", () => {
		const result = run([base("cheap")], [base("strong")])
		expect(result.defects).toHaveLength(1)
		expect(result.defects[0]).toMatchObject({ code: "meaning_drift_confirmed", severity: "major", integrity: false, pair_id: "P1", drift_kind: "scope_widened" })
		expect(result.dropped).toEqual([])
	})

	test("#given only the cheap tier flags #when ingested #then meaning_drift_warn (minor)", () => {
		const result = run([base("cheap")])
		expect(result.defects.map((d) => [d.code, d.severity])).toEqual([["meaning_drift_warn", "minor"]])
	})

	test("#given both tiers agree on other #when ingested #then warn only, never confirmed", () => {
		const result = run([base("cheap", { drift_kind: "other" })], [base("strong", { drift_kind: "other" })])
		expect(result.defects.map((d) => d.code)).toEqual(["meaning_drift_warn"])
	})

	test("#given the tiers name different drift kinds #when ingested #then warn only", () => {
		const result = run([base("cheap")], [base("strong", { drift_kind: "subject_changed" })])
		expect(result.defects.map((d) => d.code)).toEqual(["meaning_drift_warn"])
	})

	test("#given an ok verdict #when ingested #then no defect and no calibration line", () => {
		const result = run([{ pair_id: "P1", verdict: "ok", model_tier: "cheap" }])
		expect(result.defects).toEqual([])
		expect(result.calibrationLines).toEqual([])
	})

	test("#given a claim pair #when both tiers agree on evidence_grade_raised #then confirmed against the statement", () => {
		const verdict = { pair_id: "P2", verdict: "drift", drift_kind: "evidence_grade_raised", fragment: "will grow", source_fragment: "may grow", explanation: "certainty raised" }
		const result = run([{ ...verdict, model_tier: "cheap" }], [{ ...verdict, model_tier: "strong" }])
		expect(result.defects.map((d) => [d.code, d.pair_id])).toEqual([["meaning_drift_confirmed", "P2"]])
	})
})

describe("ingestVerdicts: grounding drops", () => {
	test("#given a fragment that is not in the sentence #when ingested #then dropped and counted, no defect", () => {
		const result = run([base("cheap", { fragment: "Europe" })])
		expect(result.defects).toEqual([])
		expect(result.dropped).toHaveLength(1)
		expect(result.dropped[0]).toMatchObject({ pair_id: "P1", reason: "fragment_not_found", model_tier: "cheap" })
	})

	test("#given a source fragment that is not in the quote #when ingested #then dropped", () => {
		const result = run([base("cheap", { source_fragment: "Asia" })])
		expect(result.defects).toEqual([])
		expect(result.dropped.map((d) => d.reason)).toEqual(["source_fragment_not_found"])
	})

	test("#given empty or blank fragments #when ingested #then dropped as empty", () => {
		const result = run([base("cheap", { fragment: "" })], [base("strong", { source_fragment: "   " })])
		expect(result.defects).toEqual([])
		expect(result.dropped.map((d) => d.reason)).toEqual(["empty_fragment", "empty_fragment"])
	})

	test("#given an unknown drift_kind #when ingested #then dropped", () => {
		const result = run([base("cheap", { drift_kind: "tone_shifted" })])
		expect(result.defects).toEqual([])
		expect(result.dropped.map((d) => d.reason)).toEqual(["unknown_drift_kind"])
	})

	test("#given an unknown pair id or tier #when ingested #then dropped", () => {
		const result = run([base("cheap", { pair_id: "P99" }), base("medium")])
		expect(result.dropped.map((d) => d.reason)).toEqual(["unknown_pair", "invalid_model_tier"])
	})

	test("#given extra whitespace in a fragment #when ingested #then it still grounds", () => {
		const result = run([base("cheap", { fragment: "rollout \n  was", source_fragment: " North  America " })])
		expect(result.dropped).toEqual([])
		expect(result.defects.map((d) => d.code)).toEqual(["meaning_drift_warn"])
	})

	test("#given the closed drift_kind set #when read #then it holds exactly the nine kinds", () => {
		expect([...DRIFT_KINDS]).toEqual([
			"subject_changed", "scope_widened", "hedge_dropped", "certainty_added", "causality_added",
			"direction_flipped", "population_changed", "evidence_grade_raised", "other",
		])
	})
})

describe("ingestVerdicts: calibration log", () => {
	test("#given a dispute on a confirmed pair #when ingested #then the defect stays and the line records disputed:true", () => {
		const result = run([base("cheap")], [base("strong")], { dispute: { pair_id: "P1", reason: "Scope is justified by a second observation." } })
		expect(result.defects.map((d) => d.code)).toEqual(["meaning_drift_confirmed"])
		expect(result.calibrationLines.map((line) => JSON.parse(line))).toEqual([
			{ kind: "quote", pair_id: "P1", tiers: ["cheap", "strong"], drift_kind: "scope_widened", confirmed: true, disputed: true, reason: "Scope is justified by a second observation." },
		])
	})

	test("#given two flagged pairs and one ok verdict #when ingested with a calibration path #then exactly one line per flagged pair is appended", () => {
		const calibrationPath = join(dir, "fidelity-calibration.jsonl")
		const claimDrift = { pair_id: "P2", verdict: "drift", drift_kind: "certainty_added", fragment: "will", source_fragment: "may", explanation: "x", model_tier: "cheap" }
		const cheap = [base("cheap"), claimDrift, { pair_id: "P1", verdict: "ok", model_tier: "cheap" }]
		const first = run(cheap, [], { calibrationPath })
		expect(first.calibrationLines).toHaveLength(2)
		const lines = () => readFileSync(calibrationPath, "utf8").split("\n").filter(Boolean)
		expect(lines()).toHaveLength(2)
		expect(JSON.parse(lines()[1])).toEqual({ kind: "claim", pair_id: "P2", tiers: ["cheap"], drift_kind: "certainty_added", confirmed: false, disputed: false, reason: null })
		run(cheap, [], { calibrationPath })
		expect(lines()).toHaveLength(4)
	})
})

describe("ingestVerdicts: coverage", () => {
	test("#given a pair no reader judged #when ingested #then it is reported as unverified, never as clean", () => {
		const result = run([base("cheap")], [base("strong")])
		expect(result.unverified).toEqual([{ pair_id: "P2", reason: "no_verdict" }])
	})

	test("#given a force_strong pair with only a cheap verdict #when ingested #then unverified says no_strong_verdict", () => {
		const result = run([base("cheap"), { pair_id: "P2", verdict: "ok", model_tier: "cheap" }])
		expect(result.unverified).toEqual([
			{ pair_id: "P1", reason: "no_strong_verdict" },
			{ pair_id: "P2", reason: "no_strong_verdict" },
		])
	})

	test("#given every pair read by both tiers #when ingested #then unverified is empty", () => {
		const ok = (pair_id: string, tier: string): Verdict => ({ pair_id, verdict: "ok", model_tier: tier })
		const result = run([ok("P1", "cheap"), ok("P2", "cheap")], [ok("P1", "strong"), ok("P2", "strong")])
		expect(result.unverified).toEqual([])
		expect(result.defects).toEqual([])
	})

	test("#given only dropped verdicts on a pair #when ingested #then the pair counts as unread", () => {
		const result = run([base("cheap", { fragment: "Europe" })], [base("strong", { fragment: "Europe" })])
		expect(result.unverified.map((entry) => entry.pair_id)).toEqual(["P1", "P2"])
	})
})

describe("ingestVerdicts: the reported fragment", () => {
	test("#given an earlier other verdict #when the tiers agree on a later kind #then the fragment comes from the agreed verdict", () => {
		const other = base("cheap", { drift_kind: "other", fragment: "The rollout", source_fragment: "The pilot" })
		const result = run([other, base("cheap")], [base("strong")])
		expect(result.defects).toHaveLength(1)
		expect(result.defects[0]).toMatchObject({ code: "meaning_drift_confirmed", drift_kind: "scope_widened", fragment: "worldwide", source_fragment: "North America" })
	})
})

describe("ingestVerdicts: determinism", () => {
	test("#given the same verdicts twice #when ingested #then both results are byte-for-byte equal", () => {
		const cheap = [base("cheap"), { pair_id: "P2", verdict: "drift", drift_kind: "certainty_added", fragment: "will grow", source_fragment: "may grow", model_tier: "cheap" }, base("medium")]
		const strong = [base("strong")]
		const first = JSON.stringify(run(cheap, strong))
		const second = JSON.stringify(run(cheap, strong))
		expect(second).toBe(first)
	})
})

describe("ingestVerdicts: unreadable verdict files", () => {
	test("#given a missing verdict file #when ingested #then a short typed error names the file", () => {
		const missing = join(dir, "absent.json")
		expect(() => ingestVerdicts(PAIRS, [missing])).toThrow(TypeError)
		expect(() => ingestVerdicts(PAIRS, [missing])).toThrow(/absent\.json: cannot read the verdict file/u)
	})

	test("#given invalid JSON #when ingested #then a short typed error names the file", () => {
		const path = join(dir, "broken.json")
		writeFileSync(path, "{ not json")
		expect(() => ingestVerdicts(PAIRS, [path])).toThrow(/broken\.json: the verdict file is not valid JSON/u)
	})
})

describe("ingestVerdicts: the no-model contract", () => {
	test("#given the module source #when read #then it never fetches or imports a network or model client", () => {
		const text = readFileSync(join(import.meta.dir, "meaning-check.mjs"), "utf8")
		expect(text).not.toMatch(/\bfetch\s*\(|node:https?|node:net|from\s+"(?!\.\/|node:)/u)
	})
})
