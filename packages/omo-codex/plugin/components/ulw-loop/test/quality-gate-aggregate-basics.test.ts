import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const opts = { repoRoot: process.cwd(), fs: { existsSync, statSync }, reviewerSurface: "omo-senpi" as const };
describe("aggregated quality gate basics", () => {
	it("#given rejected recommendation, empty surface evidence, and invalid artifact kind #when validating #then reports all three defects", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa evidence",
				surfaceEvidence: [],
				adversarialCases: [
					{
						id: "adv",
						criterionRef: "C001",
						scenario: "scenario",
						expectedBehavior: "reject",
						verdict: "passed",
						artifactRefs: [],
					},
				],
				artifactRefs: [
					{
						id: "artifact",
						kind: "invalid-kind",
						description: "artifact",
						path: "test/fixtures/artifacts/cli-pass.txt",
					},
				],
			},
			gateReview: {
				by: "category:deep",
				recommendation: "REJECT",
				evidence: "gate evidence",
				reportPath: "test/fixtures/artifacts/gate-review.md",
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

		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			expect(Array.isArray(fields) ? fields.map((item) => item["field"]) : []).toEqual(
				expect.arrayContaining([
					"gateReview.recommendation",
					"manualQa.surfaceEvidence",
					"manualQa.artifactRefs[0].kind",
				]),
			);
		}
	});

	it("#given an empty existing artifact and another defect #when validating #then reports both defects", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa evidence",
				surfaceEvidence: [
					{
						id: "surface",
						criterionRef: "C001",
						surface: "cli",
						invocation: "run",
						verdict: "passed",
						artifactRefs: ["empty"],
					},
				],
				adversarialCases: [
					{
						id: "adv",
						criterionRef: "C001",
						scenario: "scenario",
						expectedBehavior: "reject",
						verdict: "passed",
						artifactRefs: [],
					},
				],
				artifactRefs: [{ id: "empty", kind: "cli-transcript", description: "empty", path: "empty.txt" }],
			},
			gateReview: {
				by: "category:deep",
				recommendation: "REJECT",
				evidence: "gate evidence",
				reportPath: "test/fixtures/artifacts/gate-review.md",
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

		try {
			validateQualityGate(gate, {
				repoRoot: process.cwd(),
				reviewerSurface: "omo-senpi",
				fs: {
					existsSync: (path) => path.endsWith("empty.txt") || path.endsWith("gate-review.md"),
					statSync: () => ({ size: 0 }),
				},
			});
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			expect(Array.isArray(fields) ? fields.map((item) => item["field"]) : []).toEqual(
				expect.arrayContaining(["manualQa.artifactRefs[0].path", "gateReview.recommendation"]),
			);
		}
	});
	it("#given four independent defects #when validating #then reports all defects in one error", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "placeholder",
				surfaceEvidence: [],
				adversarialCases: [],
				artifactRefs: [
					{ id: "missing", kind: "cli-transcript", description: "artifact", path: "does-not-exist.txt" },
				],
			},
			gateReview: {
				by: "category:deep",
				recommendation: "REJECT",
				reportPath: "test/fixtures/artifacts/gate-review.md",
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
		try {
			validateQualityGate(gate, opts);
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
			expect(error.details?.["field"]).toBe("manualQa.evidence");
			expect(error.details?.["fields"]).toEqual(
				expect.arrayContaining([
					{ field: "manualQa.evidence", message: expect.stringContaining("placeholder") },
					{ field: "gateReview.evidence", message: expect.stringContaining("non-empty") },
					{ field: "gateReview.recommendation", message: expect.stringContaining("APPROVE") },
					{ field: "manualQa.artifactRefs[0].path", message: expect.stringContaining("existing") },
				]),
			);
		}
	});

	it("#given missing required fields #when validating #then reports each field in one error", () => {
		const gate = {
			manualQa: { evidence: "qa", artifactRefs: [] },
			gateReview: { by: "invalid", recommendation: "REJECT", evidence: "", reportPath: "", blockers: ["blocker"] },
			iteration: { fullRerun: false, status: "failed", rerunCommands: [], evidence: "" },
			criteriaCoverage: {
				totalCriteria: "bad",
				passCount: 0,
				originalIntent: "",
				desiredOutcome: "",
				userOutcomeReview: "",
				adversarialClassesCovered: [],
			},
		};
		expect(() => validateQualityGate(gate, { reviewerSurface: "omo-senpi" })).toThrow(/gateReview\.by/);
		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			expect(Array.isArray(fields) ? fields.map((field) => field["field"]) : []).toEqual(
				expect.arrayContaining([
					"gateReview.by",
					"iteration.status",
					"criteriaCoverage.totalCriteria",
					"manualQa.artifactRefs",
				]),
			);
		}
	});

	it("#given more than twenty-five defects #when validating #then caps the list and flags truncation", () => {
		const refs = Array.from({ length: 30 }, (_, index) => ({
			id: `ref-${index}`,
			kind: "cli-transcript",
			description: "artifact",
			path: `does-not-exist-${index}.txt`,
		}));
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "real evidence",
				surfaceEvidence: [],
				adversarialCases: [],
				artifactRefs: refs,
			},
			gateReview: {
				by: "category:deep",
				recommendation: "APPROVE",
				reportPath: "test/fixtures/artifacts/gate-review.md",
				evidence: "gate evidence",
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
		try {
			validateQualityGate(gate, opts);
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			expect(Array.isArray(fields) && fields.length).toBe(25);
			expect(error.details?.["truncated"]).toBe(true);
			expect(error.message).toContain("25+");
		}
	});
});
