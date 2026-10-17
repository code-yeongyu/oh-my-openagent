import { describe, expect, it } from "vitest";

import { ULW_LOOP_HELP } from "../src/cli-output.js";
import { validateQualityGate } from "../src/quality-gate.js";
import { statusNextActions } from "../src/status-next-actions.js";
import type { UlwLoopPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

const GATE_WITHOUT_MANUAL_QA = {
	codeReview: {
		by: "lazycodex-code-reviewer",
		recommendation: "APPROVE",
		codeQualityStatus: "CLEAR",
		reportPath: "code-review.md",
		evidence: "Reviewed the diff; no blocking issues remain.",
		blockers: [],
	},
	gateReview: {
		by: "lazycodex-gate-reviewer",
		recommendation: "APPROVE",
		reportPath: "gate-review.md",
		evidence: "Gate is approved.",
		blockers: [],
	},
	iteration: {
		fullRerun: true,
		status: "passed",
		rerunCommands: ["true"],
		evidence: "Rerun passed.",
	},
	criteriaCoverage: {
		totalCriteria: 1,
		passCount: 1,
		originalIntent: "Ship a complete gate.",
		desiredOutcome: "The gate names accepted input forms.",
		userOutcomeReview: "Outcome matches the request.",
		adversarialClassesCovered: ["malformed_input"],
	},
};

function thrownMessage(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	return "";
}

describe("quality-gate field and status messages", () => {
	it("missing-manualQa error contains accepted input and names bare-object and top-level qualityGate forms", () => {
		const message = thrownMessage(() => validateQualityGate(GATE_WITHOUT_MANUAL_QA));

		expect(message).toContain("accepted input");
		expect(message).toContain("bare object");
		expect(message).toContain('top-level "qualityGate" key');
	});

	it("status next-action text mentions currentAttemptDir", () => {
		const plan: UlwLoopPlan = {
			version: 1,
			createdAt: NOW,
			updatedAt: NOW,
			briefPath: ".omo/ulw-loop/brief.md",
			goalsPath: ".omo/ulw-loop/goals.json",
			ledgerPath: ".omo/ulw-loop/ledger.jsonl",
			activeGoalId: "G001",
			goals: [
				{
					id: "G001",
					title: "Goal one",
					objective: "Complete goal one",
					status: "in_progress",
					successCriteria: [
						{
							id: "C001",
							scenario: "works",
							userModel: "happy",
							expectedEvidence: "proof",
							capturedEvidence: "passed",
							status: "pass",
						},
					],
					attempt: 1,
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		};

		expect(statusNextActions(plan).join("\n")).toContain("currentAttemptDir");
	});

	it("CLI help mentions currentAttemptDir", () => {
		expect(ULW_LOOP_HELP).toContain("currentAttemptDir");
	});
});
