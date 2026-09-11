import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const shared = {
	gateReview: {
		by: "category:deep",
		recommendation: "APPROVE",
		evidence: "review",
		reportPath: "report.txt",
		blockers: [],
	},
	iteration: { fullRerun: true, status: "passed", rerunCommands: ["test"], evidence: "rerun" },
	criteriaCoverage: {
		totalCriteria: 1,
		passCount: 1,
		originalIntent: "intent",
		desiredOutcome: "outcome",
		userOutcomeReview: "review",
		adversarialClassesCovered: ["none"],
	},
};
function fields(gate: Record<string, unknown>, withFs = false): readonly string[] {
	try {
		validateQualityGate(gate, {
			reviewerSurface: "omo-senpi",
			...(withFs ? { repoRoot: process.cwd(), fs: { existsSync, statSync: () => ({ size: 1 }) } } : {}),
		});
	} catch (error) {
		if (error instanceof UlwLoopError) {
			const list = error.details?.["fields"];
			return Array.isArray(list) ? list.map((item) => `${String(item["field"])}: ${String(item["message"])}`) : [];
		}
		throw error;
	}
	throw new Error("expected validation failure");
}
function manual(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		by: "main-session",
		status: "passed",
		evidence: "qa",
		surfaceEvidence: [],
		adversarialCases: [],
		artifactRefs: [{ id: "a", kind: "log", description: "x", path: "x.txt" }],
		...overrides,
	};
}
describe("quality gate poisoning contract", () => {
	it.each([
		[
			"invalid artifact kind",
			[{ id: "a", kind: "invalid-kind", description: "x", path: "x.txt" }],
			(list: readonly string[]) => {
				expect(list.some((x) => x.startsWith("manualQa.artifactRefs[0].kind:"))).toBe(true);
				expect(list.some((x) => x.includes("references unknown artifact a"))).toBe(false);
			},
		],
		[
			"duplicate id with invalid kind",
			[
				{ id: "a", kind: "cli-transcript", description: "x", path: "x.txt" },
				{ id: "a", kind: "invalid-kind", description: "x", path: "x.txt" },
			],
			(list: readonly string[]) => {
				expect(list.some((x) => x.startsWith("manualQa.artifactRefs[1].kind:"))).toBe(true);
				expect(list.some((x) => x.includes("duplicate a"))).toBe(true);
			},
		],
	] as const)("#given %s #when validating #then preserves independent defects", (_name, artifactRefs, assertResult) =>
		assertResult(fields({ ...shared, manualQa: manual({ artifactRefs }) })),
	);
	it("#given a poisoned numeric input #when validating #then skips its cross-field comparison", () => {
		const list = fields({
			...shared,
			criteriaCoverage: { ...shared.criteriaCoverage, passCount: "bad" },
			manualQa: manual(),
		});
		expect(list.some((x) => x.includes("passCount") && x.includes("numeric"))).toBe(true);
		expect(list.some((x) => x.includes("cover totalCriteria"))).toBe(false);
	});
	it("#given poisoned parent rows #when validating #then suppresses all child defects", () => {
		const list = fields({ ...shared, manualQa: manual({ surfaceEvidence: [null], adversarialCases: [null] }) });
		expect(list.some((x) => x.startsWith("manualQa.surfaceEvidence[0]:"))).toBe(true);
		expect(list.some((x) => x.startsWith("manualQa.surfaceEvidence[0]."))).toBe(false);
		expect(list.some((x) => x.startsWith("manualQa.adversarialCases[0]:"))).toBe(true);
	});
	it("#given a poisoned report path #when validating with fs options #then skips file checks", () => {
		const list = fields(
			{ ...shared, gateReview: { ...shared.gateReview, reportPath: "tbd" }, manualQa: manual() },
			true,
		);
		expect(list.some((x) => x.includes("reportPath") && x.includes("placeholder"))).toBe(true);
		expect(list.some((x) => x.includes("gateReview.reportPath") && x.includes("existing artifact"))).toBe(false);
	});
});
