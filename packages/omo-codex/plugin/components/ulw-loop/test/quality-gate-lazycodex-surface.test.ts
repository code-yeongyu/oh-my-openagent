import { expect, it } from "vitest";
import { validateQualityGate } from "../src/quality-gate.js";

const base = {
	manualQa: {
		by: "main-session",
		status: "passed",
		evidence: "qa",
		surfaceEvidence: [
			{ id: "s", criterionRef: "C1", surface: "cli", invocation: "true", verdict: "passed", artifactRefs: ["a"] },
		],
		adversarialCases: [
			{
				id: "x",
				criterionRef: "C1",
				scenario: "x",
				expectedBehavior: "x",
				verdict: "not_applicable",
				reason: "x",
				artifactRefs: ["a"],
			},
		],
		artifactRefs: [{ id: "a", kind: "cli-transcript", description: "a", path: "qa.txt" }],
	},
	gateReview: {
		by: "category:unspecified-high",
		recommendation: "APPROVE",
		reportPath: "gate.md",
		evidence: "gate",
		blockers: [],
	},
	iteration: { fullRerun: true, status: "passed", rerunCommands: ["true"], evidence: "rerun" },
	criteriaCoverage: {
		totalCriteria: 1,
		passCount: 1,
		originalIntent: "i",
		desiredOutcome: "d",
		userOutcomeReview: "u",
		adversarialClassesCovered: ["x"],
	},
};
it("accepts lazycodex self-review gate without codeReview", () =>
	expect(() => validateQualityGate(base)).not.toThrow());
it("accepts wrapped and optional codeReview forms", () => {
	expect(() => validateQualityGate({ qualityGate: base })).not.toThrow();
	expect(() =>
		validateQualityGate({
			...base,
			codeReview: {
				by: "lazycodex-code-reviewer",
				recommendation: "APPROVE",
				codeQualityStatus: "CLEAR",
				reportPath: "code.md",
				evidence: "review",
				blockers: [],
			},
		}),
	).not.toThrow();
});
it("#given main-session codeReview #when validated #then preserves the accepted author", () => {
	const gate = validateQualityGate({
		...base,
		codeReview: {
			by: "main-session",
			recommendation: "APPROVE",
			codeQualityStatus: "CLEAR",
			reportPath: "code.md",
			evidence: "review",
			blockers: [],
		},
	});
	expect(gate.surface).toBe("lazycodex");
	if (gate.surface === "lazycodex") expect(gate.codeReview?.by).toBe("main-session");
});
it("#given random codeReview author #when validated #then rejects the lane", () => {
	expect(() =>
		validateQualityGate({
			...base,
			codeReview: {
				by: "random",
				recommendation: "APPROVE",
				codeQualityStatus: "CLEAR",
				reportPath: "code.md",
				evidence: "review",
				blockers: [],
			},
		}),
	).toThrow(/codeReview\.by/);
});
it("rejects an unknown gate acceptor", () =>
	expect(() => validateQualityGate({ ...base, gateReview: { ...base.gateReview, by: "random-agent" } })).toThrow(
		/gateReview\.by/,
	));
