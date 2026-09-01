import { describe, expect, it } from "vitest";
import { buildSteeringPlanSnapshot, changedGoalIdsBetween } from "../src/steering-snapshot.js";
import type { UlwLoopItem, UlwLoopPlan } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function goal(id: string, overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id,
		title: `Goal ${id}`,
		objective: `Objective for ${id}`,
		status: "pending",
		successCriteria: [],
		attempt: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function plan(goals: UlwLoopItem[], overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals,
		...overrides,
	};
}

describe("changedGoalIdsBetween", () => {
	it.each([
		{
			name: "added goal",
			before: [goal("G001"), goal("G002")],
			after: [goal("G001"), goal("G002"), goal("G003")],
			expected: ["G003"],
		},
		{
			name: "removed goal",
			before: [goal("G001"), goal("G002")],
			after: [goal("G001")],
			expected: ["G002"],
		},
		{
			name: "mutated goal",
			before: [goal("G001"), goal("G002")],
			after: [goal("G001"), goal("G002", { title: "Rewritten" })],
			expected: ["G002"],
		},
		{
			name: "reordered-only goals",
			before: [goal("G001"), goal("G002"), goal("G003")],
			after: [goal("G003"), goal("G001"), goal("G002")],
			expected: [],
		},
		{
			name: "identical plans",
			before: [goal("G001"), goal("G002")],
			after: [goal("G001"), goal("G002")],
			expected: [],
		},
		{
			name: "add + remove + mutate at once",
			before: [goal("G001"), goal("G002"), goal("G003")],
			after: [goal("G001", { status: "blocked" }), goal("G003"), goal("G004")],
			expected: ["G001", "G002", "G004"],
		},
	])("detects $name", ({ before, after, expected }) => {
		// when
		const changed = changedGoalIdsBetween(plan(before), plan(after));

		// then
		expect([...changed].sort()).toEqual(expected);
	});
});

describe("buildSteeringPlanSnapshot", () => {
	it("includes only changed goals while keeping full goalIds order and goalCount", () => {
		// given
		const goals = [goal("G001"), goal("G002"), goal("G003"), goal("G004")];
		const source = plan(goals);

		// when
		const snapshot = buildSteeringPlanSnapshot(source, new Set(["G003"]));

		// then
		expect(snapshot.goals.map((item) => item.id)).toEqual(["G003"]);
		expect(snapshot.goals[0]).toEqual(goals[2]);
		expect(snapshot.goalIds).toEqual(["G001", "G002", "G003", "G004"]);
		expect(snapshot.goalCount).toBe(4);
		expect(snapshot.updatedAt).toBe(NOW);
	});

	it("omits the activeGoalId key entirely when the plan has none", () => {
		// when
		const snapshot = buildSteeringPlanSnapshot(plan([goal("G001")]), new Set(["G001"]));

		// then
		expect("activeGoalId" in snapshot).toBe(false);
	});

	it("carries activeGoalId when the plan has one", () => {
		// when
		const snapshot = buildSteeringPlanSnapshot(plan([goal("G001")], { activeGoalId: "G001" }), new Set());

		// then
		expect(snapshot.activeGoalId).toBe("G001");
	});

	it("keeps plan order for changed goals regardless of set insertion order", () => {
		// given
		const source = plan([goal("G001"), goal("G002"), goal("G003")]);

		// when
		const snapshot = buildSteeringPlanSnapshot(source, new Set(["G003", "G001"]));

		// then
		expect(snapshot.goals.map((item) => item.id)).toEqual(["G001", "G003"]);
	});
});
