import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const COMMON = {
	manualQa: {
		status: "passed",
		evidence: "Ran senpi manual QA with artifact-backed evidence.",
		surfaceEvidence: [
			{
				id: "surface-cli-pass",
				criterionRef: "C1",
				surface: "cli",
				invocation: "omo-agent-toolkit ulw-loop checkpoint --status complete",
				verdict: "passed",
				artifactRefs: ["artifact-cli-pass"],
			},
		],
		adversarialCases: [
			{
				id: "adv-role",
				criterionRef: "C2",
				scenario: "a reviewer role is invalid",
				expectedBehavior: "the gate rejects the invalid role",
				verdict: "passed",
				artifactRefs: ["artifact-cli-pass"],
			},
		],
		artifactRefs: [
			{
				id: "artifact-cli-pass",
				kind: "cli-transcript",
				description: "CLI transcript for valid checkpoint.",
				path: "cli-pass.txt",
			},
		],
	},
	iteration: {
		fullRerun: true,
		status: "passed",
		rerunCommands: ["bunx vitest run"],
		evidence: "Focused tests passed.",
	},
	criteriaCoverage: {
		totalCriteria: 2,
		passCount: 2,
		originalIntent: "User wanted a valid senpi quality gate.",
		desiredOutcome: "The senpi gate accepts its four required lanes.",
		userOutcomeReview: "The requested senpi outcome is covered.",
		adversarialClassesCovered: ["role_mismatch"],
	},
} as const;

function senpiGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		...COMMON,
		manualQa: { ...COMMON.manualQa, by: "main-session" },
		gateReview: {
			by: "category:deep",
			recommendation: "APPROVE",
			reportPath: "gate-review.md",
			evidence: "Verified the senpi gate.",
			blockers: [],
		},
		...overrides,
	};
}

function section(input: Record<string, unknown>, key: string): Record<string, unknown> {
	const value = input[key];
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`missing object section: ${key}`);
	return value as Record<string, unknown>;
}

function errorFor(input: unknown): UlwLoopError {
	try {
		validateQualityGate(input, { reviewerSurface: "omo-senpi" });
	} catch (error) {
		if (error instanceof UlwLoopError) return error;
		throw error;
	}
	throw new Error("Expected quality gate validation to fail");
}

describe("validateQualityGate omo-senpi surface", () => {
	it("#given a four-section senpi gate #when validated #then it accepts main-session manual QA and category:deep review", () => {
		expect(() => validateQualityGate(senpiGate(), { reviewerSurface: "omo-senpi" })).not.toThrow();
	});

	it("#given a senpi gate with codeReview #when validated #then it rejects the forbidden codeReview lane", () => {
		const error = errorFor(senpiGate({ codeReview: { by: "anything" } }));
		expect(error.details?.["field"]).toContain("codeReview");
		expect(error.message).toContain("omo-senpi gate has no codeReview lane");
	});

	it.each(["category:deep", "category:unspecified-high", "category:unspecified-low"])(
		"#given gateReview.by %s #when validated on senpi #then it accepts the category role",
		(by) => {
			expect(() =>
				validateQualityGate(senpiGate({ gateReview: { ...section(senpiGate(), "gateReview"), by } }), {
					reviewerSurface: "omo-senpi",
				}),
			).not.toThrow();
		},
	);

	it.each(["omo-senpi-gate-reviewer", "lazycodex-gate-reviewer", "arbitrary"])(
		"#given gateReview.by %s #when validated on senpi #then it rejects the non-category role",
		(by) => {
			const error = errorFor(senpiGate({ gateReview: { ...section(senpiGate(), "gateReview"), by } }));
			expect(error.message).toContain("gateReview.by");
		},
	);

	it.each(["omo-senpi-qa-executor", "lazycodex-qa-executor", "arbitrary"])(
		"#given manualQa.by %s #when validated on senpi #then it rejects the non-main-session role",
		(by) => {
			const error = errorFor(senpiGate({ manualQa: { ...COMMON.manualQa, by } }));
			expect(error.message).toContain("manualQa.by");
		},
	);

	it("#given the existing lazycodex fixture #when validated on the default surface #then it remains valid", async () => {
		const raw = await readFile(new URL("./fixtures/sample-quality-gate.json", import.meta.url), "utf8");
		expect(() => validateQualityGate(JSON.parse(raw))).not.toThrow();
	});
});
