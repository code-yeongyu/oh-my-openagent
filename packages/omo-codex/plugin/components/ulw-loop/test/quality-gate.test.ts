import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
	classifyExternalAuthorizationBlocker,
	clearGoalBlockerFields,
	normalizeBlockerEvidence,
	sameBlockerOccurrences,
	validateQualityGate,
} from "../src/quality-gate.js";
import type { UlwLoopItem, UlwLoopPlan } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const VALID_GATE = {
	aiSlopCleaner: { status: "passed", evidence: "no slop detected after cleaner run" },
	verification: { status: "passed", commands: ["npm test"], evidence: "all tests pass" },
	codeReview: { recommendation: "APPROVE", architectStatus: "CLEAR", evidence: "ship it" },
	criteriaCoverage: { totalCriteria: 2, passCount: 2, adversarialClassesCovered: ["malformed_input"] },
} as const;

interface GoalWithBlocker extends UlwLoopItem {
	blocker?: { readonly signature: string };
	blockerEvidence?: string;
	blockerOccurrences?: number;
	blockedAt?: string;
}

function makeGate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...VALID_GATE, ...overrides };
}

function getQualityGateError(input: unknown): UlwLoopError {
	try {
		validateQualityGate(input);
	} catch (error) {
		if (error instanceof UlwLoopError) return error;
		throw error;
	}
	throw new Error("Expected UlwLoopError");
}

function makeGoal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Goal one",
		objective: "Complete goal one",
		status: "pending",
		successCriteria: [],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makePlan(goals: UlwLoopItem[]): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals,
	};
}

describe("validateQualityGate", () => {
	it("accepts valid quality gate from fixture", async () => {
		// given
		const raw = await readFile(new URL("./fixtures/sample-quality-gate.json", import.meta.url), "utf8");
		const parsed: unknown = JSON.parse(raw);

		// when
		const gate = validateQualityGate(parsed);

		// then
		expect(gate.aiSlopCleaner.status).toBe("passed");
		expect(gate).toMatchObject({ criteriaCoverage: { totalCriteria: 9, passCount: 9 } });
	});

	it("throws UlwLoopError when aiSlopCleaner missing", () => {
		// when
		const error = getQualityGateError(makeGate({ aiSlopCleaner: undefined }));

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
	});

	it("throws UlwLoopError when verification missing", () => {
		// when
		const error = getQualityGateError(makeGate({ verification: undefined }));

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
	});

	it("throws UlwLoopError when codeReview missing", () => {
		// when
		const error = getQualityGateError(makeGate({ codeReview: undefined }));

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
	});

	it("throws UlwLoopError when criteriaCoverage missing (NEW)", () => {
		// when
		const error = getQualityGateError(makeGate({ criteriaCoverage: undefined }));

		// then
		expect(error.code).toBe("ULW_LOOP_QUALITY_GATE_INVALID");
	});

	it("throws UlwLoopError when criteriaCoverage.passCount < totalCriteria (NEW)", () => {
		// when
		const error = getQualityGateError(
			makeGate({ criteriaCoverage: { totalCriteria: 3, passCount: 2, adversarialClassesCovered: [] } }),
		);

		// then
		expect(error.message).toContain("criteriaCoverage.passCount");
	});

	it("throws UlwLoopError when codeReview.recommendation is not APPROVE", () => {
		// when
		const error = getQualityGateError(
			makeGate({ codeReview: { ...VALID_GATE.codeReview, recommendation: "COMMENT" } }),
		);

		// then
		expect(error.message).toContain("recommendation");
	});

	it("throws UlwLoopError when architectStatus is not CLEAR", () => {
		// when
		const error = getQualityGateError(
			makeGate({ codeReview: { ...VALID_GATE.codeReview, architectStatus: "WATCH" } }),
		);

		// then
		expect(error.message).toContain("architectStatus");
	});
});

describe("classifyExternalAuthorizationBlocker", () => {
	it("returns GHCR signature when evidence mentions ghcr.io auth failure", () => {
		expect(
			classifyExternalAuthorizationBlocker("ghcr.io returned 401 authentication required for package pull"),
		).toBe("GHCR_PULL_ACCESS:HTTP_401_ANONYMOUS:GHCR_VISIBILITY_OR_CREDENTIAL_REQUIRED");
	});

	it("returns generic auth signature for generic 401 evidence", () => {
		expect(classifyExternalAuthorizationBlocker("Registry returned 401 because credentials are missing")).toBe(
			"EXTERNAL_AUTHORIZATION_REQUIRED",
		);
	});

	it("returns null when no auth keywords", () => {
		expect(classifyExternalAuthorizationBlocker("build failed because tests failed")).toBeNull();
	});
});

describe("normalizeBlockerEvidence", () => {
	it("collapses whitespace + lowercases", () => {
		expect(normalizeBlockerEvidence(" GHCR.IO\n\tNeeds   TOKEN ")).toBe("ghcr.io needs token");
	});
});

describe("sameBlockerOccurrences", () => {
	it("counts goals matching signature", () => {
		// given
		const nested: GoalWithBlocker = { ...makeGoal({ id: "G002" }), blocker: { signature: "AUTH" } };
		const plan = makePlan([makeGoal({ blockerSignature: "AUTH" }), nested, makeGoal({ id: "G003" })]);

		// when/then
		expect(sameBlockerOccurrences(plan, "AUTH")).toBe(2);
	});
});

describe("clearGoalBlockerFields", () => {
	it("clears all 5 blocker fields", () => {
		// given
		const goal: GoalWithBlocker = {
			...makeGoal({ blockerSignature: "AUTH" }),
			blocker: { signature: "AUTH" },
			blockerEvidence: "401 unauthorized",
			blockerOccurrences: 2,
			blockedAt: NOW,
		};

		// when
		clearGoalBlockerFields(goal);

		// then
		expect(goal).not.toHaveProperty("blocker");
		expect(goal).not.toHaveProperty("blockerSignature");
		expect(goal).not.toHaveProperty("blockerEvidence");
		expect(goal).not.toHaveProperty("blockerOccurrences");
		expect(goal).not.toHaveProperty("blockedAt");
	});
});
