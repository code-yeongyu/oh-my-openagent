import { describe, expect, it } from "vitest";

import {
	classifyExternalAuthorizationBlocker,
	clearGoalBlockerFields,
	normalizeBlockerEvidence,
	sameBlockerOccurrences,
} from "../src/quality-gate.js";
import type { UlwLoopItem, UlwLoopPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

interface GoalWithBlocker extends UlwLoopItem {
	blocker?: { readonly signature: string };
	blockerEvidence?: string;
	blockerOccurrences?: number;
	blockedAt?: string;
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
