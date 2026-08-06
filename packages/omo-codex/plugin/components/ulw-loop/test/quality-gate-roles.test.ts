import { describe, expect, it } from "vitest";

import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const BASE_GATE = {
	codeReview: {
		by: "lazycodex-code-reviewer",
		recommendation: "APPROVE",
		codeQualityStatus: "CLEAR",
		reportPath: "code-review.md",
		evidence: "Reviewed the implementation and found no blockers.",
		blockers: [],
	},
	manualQa: {
		by: "lazycodex-qa-executor",
		status: "passed",
		evidence: "Ran artifact-backed manual QA scenarios.",
		surfaceEvidence: [
			{
				id: "surface-cli-pass",
				criterionRef: "C1",
				surface: "cli",
				invocation: "omo ulw-loop checkpoint --status complete",
				verdict: "passed",
				artifactRefs: ["artifact-cli-pass"],
			},
		],
		adversarialCases: [
			{
				id: "adv-role-swap",
				criterionRef: "C2",
				scenario: "quality gate sections use swapped reviewer roles",
				expectedBehavior: "validator rejects the section-specific role mismatch",
				verdict: "passed",
				artifactRefs: ["artifact-cli-reject"],
			},
		],
		artifactRefs: [
			{
				id: "artifact-cli-pass",
				kind: "cli-transcript",
				description: "CLI transcript for accepted checkpoint.",
				path: "cli-pass.txt",
			},
			{
				id: "artifact-cli-reject",
				kind: "log",
				description: "Log proving invalid gate rejection.",
				path: "rejection.txt",
			},
		],
	},
	gateReview: {
		by: "lazycodex-gate-reviewer",
		recommendation: "APPROVE",
		reportPath: "gate-review.md",
		evidence: "Rechecked the quality gate and found no blockers.",
		blockers: [],
	},
	iteration: {
		fullRerun: true,
		status: "passed",
		rerunCommands: ["bunx vitest run test/quality-gate-roles.test.ts"],
		evidence: "Focused role validation tests passed.",
	},
	criteriaCoverage: {
		totalCriteria: 2,
		passCount: 2,
		adversarialClassesCovered: ["arbitrary_role", "swapped_role"],
	},
} as const;

function gateWith(overrides: Record<string, unknown>): Record<string, unknown> {
	return { ...BASE_GATE, ...overrides };
}

function qualityGateError(input: unknown): UlwLoopError {
	try {
		validateQualityGate(input);
	} catch (error) {
		if (error instanceof UlwLoopError) return error;
		throw error;
	}
	throw new Error("Expected UlwLoopError");
}

describe("validateQualityGate reviewer roles", () => {
	it("#given arbitrary reviewer role names #when validated #then each role field is rejected", () => {
		const cases = [
			{
				field: "codeReview.by",
				input: gateWith({ codeReview: { ...BASE_GATE.codeReview, by: "senior-reviewer" } }),
			},
			{ field: "manualQa.by", input: gateWith({ manualQa: { ...BASE_GATE.manualQa, by: "qa-person" } }) },
			{
				field: "gateReview.by",
				input: gateWith({ gateReview: { ...BASE_GATE.gateReview, by: "release-manager" } }),
			},
		] as const;

		for (const roleCase of cases) {
			const error = qualityGateError(roleCase.input);
			expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
			expect(error.message).toContain(roleCase.field);
		}
	});

	it("#given swapped LazyCodex reviewer roles #when validated #then section-specific roles are enforced", () => {
		const cases = [
			{
				field: "codeReview.by",
				input: gateWith({ codeReview: { ...BASE_GATE.codeReview, by: "lazycodex-qa-executor" } }),
			},
			{
				field: "manualQa.by",
				input: gateWith({ manualQa: { ...BASE_GATE.manualQa, by: "lazycodex-gate-reviewer" } }),
			},
			{
				field: "gateReview.by",
				input: gateWith({ gateReview: { ...BASE_GATE.gateReview, by: "lazycodex-code-reviewer" } }),
			},
		] as const;

		for (const roleCase of cases) {
			const error = qualityGateError(roleCase.input);
			expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
			expect(error.message).toContain(roleCase.field);
		}
	});
});
