import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const opts = { repoRoot: process.cwd(), fs: { existsSync, statSync }, reviewerSurface: "omo-senpi" as const };

describe("aggregated quality gate validation", () => {
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
