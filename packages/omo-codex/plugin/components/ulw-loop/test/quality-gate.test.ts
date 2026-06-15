import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateQualityGate } from "../src/quality-gate.js";
import { UlwLoopError } from "../src/types.js";

const VALID_GATE = {
	codeReview: {
		by: "lazycodex-code-reviewer",
		recommendation: "APPROVE",
		codeQualityStatus: "CLEAR",
		reportPath: "packages/omo-codex/plugin/components/ulw-loop/test/fixtures/artifacts/code-review.md",
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
				path: "packages/omo-codex/plugin/components/ulw-loop/test/fixtures/artifacts/cli-pass.txt",
			},
			{
				id: "artifact-cli-reject",
				kind: "log",
				description: "Log proving malformed quality gate rejection.",
				path: "packages/omo-codex/plugin/components/ulw-loop/test/fixtures/artifacts/rejection.txt",
			},
		],
	},
	gateReview: {
		by: "lazycodex-gate-reviewer",
		recommendation: "APPROVE",
		reportPath: "packages/omo-codex/plugin/components/ulw-loop/test/fixtures/artifacts/gate-review.md",
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
		adversarialClassesCovered: ["malformed_input", "stale_state"],
	},
} as const;
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const FS_OPTS = { repoRoot: REPO_ROOT, fs: { existsSync, statSync } } as const;

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
		expect(gate).toMatchObject({ criteriaCoverage: { totalCriteria: 9, passCount: 9 } });
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

	it("#given the old aiSlopCleaner and verification schema #when validated #then it is rejected", () => {
		// given
		const input = {
			aiSlopCleaner: { status: "passed", evidence: "no slop detected after cleaner run" },
			verification: { status: "passed", commands: ["npm test"], evidence: "all tests pass" },
			codeReview: { recommendation: "APPROVE", architectStatus: "CLEAR", evidence: "ship it" },
			criteriaCoverage: { totalCriteria: 2, passCount: 2, adversarialClassesCovered: ["malformed_input"] },
		};

		// when
		const error = getQualityGateError(input);

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
		expect(error.message).toContain("manualQa");
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

		// then
		expect(error.message).toContain("not_applicable");
	});

	it("#given criteria coverage misses required criteria #when validated #then it is rejected", () => {
		// when
		const error = getQualityGateError(
			makeGate({ criteriaCoverage: { totalCriteria: 3, passCount: 2, adversarialClassesCovered: [] } }),
		);

		// then
		expect(error.message).toContain("criteriaCoverage.passCount");
	});
});
