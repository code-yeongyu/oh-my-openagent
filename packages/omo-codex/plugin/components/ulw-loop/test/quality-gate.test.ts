import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const VALID_GATE = {
	codeReview: {
		by: "lazycodex-code-reviewer",
		recommendation: "APPROVE",
		codeQualityStatus: "CLEAR",
		reportPath: "test/fixtures/artifacts/code-review.md",
		evidence: "Reviewed diff and focused tests; no blocking code-quality issues remain.",
		blockers: [],
	},
	manualQa: {
		by: "lazycodex-qa-executor",
		status: "passed",
		evidence: "Executed CLI validation scenarios and captured artifact-backed outcomes.",
		surfaceEvidence: [
			{
				id: "surface-cli-pass",
				criterionRef: "C1",
				surface: "cli",
				invocation: "node dist/quality-gate.js validate sample-quality-gate.json",
				verdict: "passed",
				artifactRefs: ["artifact-cli-pass"],
			},
		],
		adversarialCases: [
			{
				id: "adv-malformed-input",
				criterionRef: "C2",
				scenario: "malformed gate input omits manual QA evidence",
				expectedBehavior: "validator rejects the gate with ULW_LOOP_QUALITY_GATE_INVALID",
				verdict: "passed",
				artifactRefs: ["artifact-cli-reject"],
			},
		],
		artifactRefs: [
			{
				id: "artifact-cli-pass",
				kind: "cli-transcript",
				description: "CLI transcript for valid quality gate acceptance.",
				path: "test/fixtures/artifacts/cli-pass.txt",
			},
			{
				id: "artifact-cli-reject",
				kind: "log",
				description: "Log proving malformed quality gate rejection.",
				path: "test/fixtures/artifacts/rejection.txt",
			},
		],
	},
	gateReview: {
		by: "lazycodex-gate-reviewer",
		recommendation: "APPROVE",
		reportPath: "test/fixtures/artifacts/gate-review.md",
		evidence: "Rechecked reviewer reports and manual QA artifacts; gate is approved.",
		blockers: [],
	},
	iteration: {
		fullRerun: true,
		status: "passed",
		rerunCommands: ["bunx vitest run packages/omo-codex/plugin/components/ulw-loop/test/quality-gate.test.ts"],
		evidence: "Full focused rerun passed after validator update.",
	},
	criteriaCoverage: {
		totalCriteria: 2,
		passCount: 2,
		originalIntent: "User wanted a strict final quality gate.",
		desiredOutcome: "The gate accepts only complete artifact-backed completion.",
		userOutcomeReview: "The work satisfies the user's requested outcome with reviewed evidence.",
		adversarialClassesCovered: ["malformed_input", "stale_state"],
	},
} as const;
const COMPONENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FS_OPTS = { repoRoot: COMPONENT_ROOT, fs: { existsSync, statSync } } as const;

function makeGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...VALID_GATE, ...overrides };
}

function getQualityGateError(input: unknown): UlwLoopError {
	try {
		validateQualityGate(input, FS_OPTS);
	} catch (error) {
		if (error instanceof UlwLoopError) return error;
		throw error;
	}
	throw new Error("Expected UlwLoopError");
}

describe("validateQualityGate", () => {
	it("#given the new five-section gate fixture #when validated without fs opts #then it passes shape validation", async () => {
		// given
		const raw = await readFile(new URL("./fixtures/sample-quality-gate.json", import.meta.url), "utf8");
		const parsed: unknown = JSON.parse(raw);

		// when
		const gate = validateQualityGate(parsed);

		// then
		expect(Object.keys(gate).sort()).toEqual([
			"codeReview",
			"criteriaCoverage",
			"gateReview",
			"iteration",
			"manualQa",
		]);
		expect(gate.codeReview.codeQualityStatus).toBe("CLEAR");
		expect(gate).toMatchObject({
			criteriaCoverage: { totalCriteria: 9, passCount: 9, userOutcomeReview: expect.stringContaining("user") },
		});
	});

	it("#given the new five-section gate fixture #when validated with fs opts #then report and artifact paths must exist", async () => {
		// given
		const raw = await readFile(new URL("./fixtures/sample-quality-gate.json", import.meta.url), "utf8");
		const parsed: unknown = JSON.parse(raw);

		// when
		const gate = validateQualityGate(parsed, FS_OPTS);

		// then
		expect(gate.codeReview.recommendation).toBe("APPROVE");
		expect(gate.manualQa.artifactRefs).toHaveLength(5);
	});

	it("#given missing manualQa surface evidence #when validated #then it fails closed", () => {
		// given
		const input = makeGate({
			manualQa: { ...VALID_GATE.manualQa, surfaceEvidence: [] },
		});

		// when
		const error = getQualityGateError(input);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("manualQa.surfaceEvidence");
	});

	it("#given unresolved manual QA artifact refs #when validated #then it rejects the gate", () => {
		// when
		const error = getQualityGateError(
			makeGate({
				manualQa: {
					...VALID_GATE.manualQa,
					surfaceEvidence: [{ ...VALID_GATE.manualQa.surfaceEvidence[0], artifactRefs: ["missing-artifact"] }],
				},
			}),
		);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("missing-artifact");
	});

	it("#given incompatible surface artifact kind #when validated #then it rejects the gate", () => {
		// when
		const error = getQualityGateError(
			makeGate({
				manualQa: {
					...VALID_GATE.manualQa,
					artifactRefs: [{ ...VALID_GATE.manualQa.artifactRefs[0], kind: "http-dump" }],
				},
			}),
		);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("cli");
	});

	it("#given placeholder evidence and artifact path #when validated #then it rejects placeholders", () => {
		// when
		const error = getQualityGateError(
			makeGate({
				manualQa: {
					...VALID_GATE.manualQa,
					evidence: "todo",
					artifactRefs: [{ ...VALID_GATE.manualQa.artifactRefs[0], path: "tbd" }],
				},
			}),
		);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("placeholder");
	});

	it("#given gate review blockers #when validated #then approval is rejected", () => {
		// when
		const error = getQualityGateError(
			makeGate({ gateReview: { ...VALID_GATE.gateReview, blockers: ["manual QA artifact missing"] } }),
		);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("gateReview.blockers");
	});

	it("#given iteration did not perform a full rerun #when validated #then it is rejected", () => {
		// when
		const error = getQualityGateError(makeGate({ iteration: { ...VALID_GATE.iteration, fullRerun: false } }));

		// then
		expect(error.message).toContain("iteration.fullRerun");
	});

	it("#given a not_applicable adversarial case #when validated #then it is rejected", () => {
		// when
		const error = getQualityGateError(
			makeGate({
				manualQa: {
					...VALID_GATE.manualQa,
					adversarialCases: [{ ...VALID_GATE.manualQa.adversarialCases[0], verdict: "not_applicable" }],
				},
			}),
		);

		// then — a reasonless not_applicable now fails on the missing reason field
		expect(error.message).toContain("reason");
	});

	it("#given criteria coverage misses required criteria #when validated #then it is rejected", () => {
		// when
		const error = getQualityGateError(
			makeGate({ criteriaCoverage: { totalCriteria: 3, passCount: 2, adversarialClassesCovered: [] } }),
		);

		// then
		expect(error.message).toContain("criteriaCoverage.passCount");
	});

	it("#given criteria coverage lacks user-outcome review #when validated #then it is rejected", () => {
		// when
		const error = getQualityGateError(
			makeGate({
				criteriaCoverage: { ...VALID_GATE.criteriaCoverage, userOutcomeReview: "" },
			}),
		);

		// then
		expect(error.message).toContain("criteriaCoverage.userOutcomeReview");
	});
});

describe("quality gate middle states (WATCH / reasoned not_applicable)", () => {
	it("#given codeQualityStatus WATCH with APPROVE #when validating #then the gate accepts", () => {
		const gate = structuredClone(VALID_GATE);
		(gate.codeReview as { codeQualityStatus: string }).codeQualityStatus = "WATCH";
		expect(() => validateQualityGate(gate)).not.toThrow();
	});

	it("#given codeQualityStatus BLOCK #when validating #then the gate rejects", () => {
		const gate = structuredClone(VALID_GATE);
		(gate.codeReview as { codeQualityStatus: string }).codeQualityStatus = "BLOCK";
		expect(() => validateQualityGate(gate)).toThrow(/codeQualityStatus/);
	});

	it("#given a reasoned not_applicable adversarial case #when validating #then the gate accepts", () => {
		const gate = structuredClone(VALID_GATE);
		(gate.manualQa.adversarialCases[0] as { verdict: string; reason?: string }).verdict = "not_applicable";
		(gate.manualQa.adversarialCases[0] as { verdict: string; reason?: string }).reason = "doc-only change";
		expect(() => validateQualityGate(gate)).not.toThrow();
	});

	it("#given a reasonless not_applicable adversarial case #when validating #then the gate rejects", () => {
		const gate = structuredClone(VALID_GATE);
		(gate.manualQa.adversarialCases[0] as { verdict: string }).verdict = "not_applicable";
		expect(() => validateQualityGate(gate)).toThrow(/reason/);
	});

	it("#given a not_applicable surface evidence verdict #when validating #then the gate still rejects", () => {
		const gate = structuredClone(VALID_GATE);
		(gate.manualQa.surfaceEvidence[0] as { verdict: string }).verdict = "not_applicable";
		expect(() => validateQualityGate(gate)).toThrow(/not_applicable/);
	});
});

describe("validateQualityGate attempt containment", () => {
	const ATTEMPT_OPTS = { ...FS_OPTS, currentAttemptDir: "test/fixtures/artifacts" } as const;

	it("#given artifacts inside the current attempt dir #when validating #then the gate accepts", () => {
		expect(() => validateQualityGate(makeGate(), ATTEMPT_OPTS)).not.toThrow();
	});

	it("#given an artifact outside the current attempt dir #when validating #then the gate rejects naming the path", () => {
		const opts = { ...FS_OPTS, currentAttemptDir: "test/fixtures/elsewhere" } as const;
		expect(() => validateQualityGate(makeGate(), opts)).toThrow(
			/\(test\/fixtures\/artifacts\/cli-pass\.txt\) must point to an artifact from the current attempt \(test\/fixtures\/elsewhere\)/,
		);
	});

	it("#given a sibling dir sharing the attempt dir prefix #when validating #then the gate still rejects", () => {
		const opts = { ...FS_OPTS, currentAttemptDir: "test/fixtures/artifact" } as const;
		expect(() => validateQualityGate(makeGate(), opts)).toThrow(/current attempt/);
	});
});
