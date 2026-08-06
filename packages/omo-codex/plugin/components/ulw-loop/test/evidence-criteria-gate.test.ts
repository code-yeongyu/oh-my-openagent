import { describe, expect, it } from "vitest";

import { requireAllCriteriaPass, requireEssentialCriteriaPass } from "../src/evidence.js";
import type { UlwLoopItem, UlwLoopSuccessCriterion } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function makeCriterion(overrides: Partial<UlwLoopSuccessCriterion> = {}): UlwLoopSuccessCriterion {
	return {
		id: "C001",
		scenario: "happy path login returns 200",
		userModel: "happy",
		expectedEvidence: "curl /login -d {valid} returns 200 + token",
		capturedEvidence: null,
		status: "pending",
		...overrides,
	};
}

function makeGoal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Auth endpoint",
		objective: "Build JWT auth",
		status: "in_progress",
		successCriteria: [
			makeCriterion({ id: "C001" }),
			makeCriterion({ id: "C002", userModel: "edge" }),
			makeCriterion({ id: "C003", userModel: "regression" }),
		],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

describe("requireAllCriteriaPass", () => {
	it("does NOT throw when all criteria pass", () => {
		// given
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass" }),
				makeCriterion({ id: "C002", status: "pass" }),
			],
		});

		// when / then
		expect(() => requireAllCriteriaPass(goal)).not.toThrow();
	});

	it("throws UlwLoopError when any criterion pending", () => {
		// given
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass" }),
				makeCriterion({ id: "C002", status: "pending" }),
				makeCriterion({ id: "C003", status: "pass" }),
			],
		});

		// when / then
		expect(() => requireAllCriteriaPass(goal)).toThrow(UlwLoopError);
	});

	it("throws when any fail/blocked too", () => {
		// given
		const goal1 = makeGoal({ successCriteria: [makeCriterion({ id: "C001", status: "fail" })] });
		const goal2 = makeGoal({ successCriteria: [makeCriterion({ id: "C001", status: "blocked" })] });

		// when / then
		expect(() => requireAllCriteriaPass(goal1)).toThrow(UlwLoopError);
		expect(() => requireAllCriteriaPass(goal2)).toThrow(UlwLoopError);
	});

	it("UlwLoopError includes details.goalId + details.unresolved", () => {
		// given
		const goal = makeGoal({
			id: "G001",
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass" }),
				makeCriterion({ id: "C002", status: "pending" }),
				makeCriterion({ id: "C003", status: "pass" }),
			],
		});

		// when / then
		try {
			requireAllCriteriaPass(goal);
			expect.fail("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(UlwLoopError);
			if (!(error instanceof UlwLoopError)) throw error;
			expect(error.code).toBe("ulw_loop_criteria_not_all_pass");
			expect(error.details?.["goalId"]).toBe("G001");
			expect(Array.isArray(error.details?.["unresolved"])).toBe(true);
		}
	});
});

describe("requireEssentialCriteriaPass", () => {
	it("does NOT throw when essential criteria pass and non-essential criteria are pending", () => {
		// given
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass", essential: true }),
				makeCriterion({ id: "C002", status: "pending", essential: false }),
			],
		});

		// when / then
		expect(() => requireEssentialCriteriaPass(goal)).not.toThrow();
	});

	it("throws when an essential criterion is pending", () => {
		// given
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pending", essential: true }),
				makeCriterion({ id: "C002", status: "pass", essential: false }),
			],
		});

		// when / then
		expect(() => requireEssentialCriteriaPass(goal)).toThrow(UlwLoopError);
	});
});
