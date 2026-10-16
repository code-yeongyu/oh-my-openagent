import { describe, expect, it } from "vitest";
import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

describe("quality gate single report per invalid value", () => {
	it("#given an empty artifact reference id #when validating #then reports only the array item defect", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa",
				surfaceEvidence: [
					{
						id: "surface",
						criterionRef: "C001",
						surface: "cli",
						invocation: "run",
						verdict: "passed",
						artifactRefs: [""],
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
				artifactRefs: [{ id: "artifact", kind: "cli-transcript", description: "artifact", path: "artifact.txt" }],
			},
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
		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			const artifactFields = Array.isArray(fields)
				? fields.filter((item) => item["field"] === "manualQa.surfaceEvidence[0].artifactRefs")
				: [];
			expect(artifactFields).toHaveLength(1);
		}
	});

	it("#given a malformed artifact entry #when validating #then does not derive downstream artifact defects", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa",
				surfaceEvidence: [],
				adversarialCases: [],
				artifactRefs: [null],
			},
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
		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			const artifactFields = Array.isArray(fields)
				? fields.filter((item) => String(item["field"]).startsWith("manualQa.artifactRefs[0]"))
				: [];
			expect(artifactFields).toHaveLength(1);
			expect(artifactFields[0]?.["field"]).toBe("manualQa.artifactRefs[0]");
		}
	});

	it("#given an invalid artifact kind #when validating #then does not derive compatibility defects", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa",
				surfaceEvidence: [
					{
						id: "surface",
						criterionRef: "C001",
						// A data surface accepts only data-diff, so the validator's "log" fallback
						// for the invalid kind WOULD trip the compatibility check if poisoning
						// were removed; a cli surface would let the fallback pass silently.
						surface: "data",
						invocation: "run",
						verdict: "passed",
						artifactRefs: ["artifact"],
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
				artifactRefs: [{ id: "artifact", kind: "invalid", description: "artifact", path: "artifact.txt" }],
			},
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
		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			const labels = Array.isArray(fields) ? fields.map((item) => item["field"]) : [];
			expect(labels).toContain("manualQa.artifactRefs[0].kind");
			expect(labels).not.toContain("manualQa.surfaceEvidence");
			expect(labels).not.toContain("manualQa.surfaceEvidence[0].artifactRefs");
			expect(labels.filter((label) => label === "manualQa.artifactRefs[0].kind")).toHaveLength(1);
		}
	});
	it("#given an empty gate #when validating #then reports each missing section once", () => {
		try {
			validateQualityGate({}, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			const labels = Array.isArray(fields) ? fields.map((item) => item["field"]) : [];
			expect(labels).toEqual(expect.arrayContaining(["manualQa", "gateReview", "iteration", "criteriaCoverage"]));
			expect(new Set(labels).size).toBe(labels.length);
		}
	});

	it("#given a not-applicable surface verdict #when validating #then reports that verdict defect once", () => {
		const gate = {
			manualQa: {
				by: "main-session",
				status: "passed",
				evidence: "qa",
				surfaceEvidence: [
					{
						id: "surface",
						criterionRef: "C001",
						surface: "cli",
						invocation: "run",
						verdict: "not_applicable",
						artifactRefs: [],
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
				artifactRefs: [{ id: "artifact", kind: "cli-transcript", description: "artifact", path: "artifact.txt" }],
			},
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
		try {
			validateQualityGate(gate, { reviewerSurface: "omo-senpi" });
			throw new Error("expected validation failure");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			const fields = error.details?.["fields"];
			const verdictFields = Array.isArray(fields)
				? fields.filter((item) => item["field"] === "manualQa.surfaceEvidence[0].verdict")
				: [];
			expect(verdictFields).toHaveLength(1);
		}
	});
});
