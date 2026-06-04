import { describe, expect, it } from "vitest";

import {
	aggregateCodexObjective,
	codexGoalMode,
	compatibleCodexObjectives,
	expectedCodexObjective,
	firstUnresolvedCriterion,
	hasAllCriteriaPass,
	isFinalRunCompletionCandidate,
	isUlwLoopDone,
	ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE,
} from "../src/goal-status.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

function makeCriterion(overrides: Partial<UlwLoopSuccessCriterion> = {}): UlwLoopSuccessCriterion {
	return {
		id: "C001",
		scenario: "happy path",
		userModel: "happy",
		expectedEvidence: "observable proof",
		capturedEvidence: null,
		status: "pending",
		...overrides,
	};
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

function makePlan(overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		goals: [],
		...overrides,
	};
}

describe("isUlwLoopDone", () => {
	it("returns true when all goals complete", () => {
		// given
		const plan = makePlan({
			goals: [makeGoal({ status: "complete" }), makeGoal({ id: "G002", status: "complete" })],
		});

		// when
		const done = isUlwLoopDone(plan);

		// then
		expect(done).toBe(true);
	});

	it("returns false when any pending remains", () => {
		// given
		const plan = makePlan({ goals: [makeGoal({ status: "complete" }), makeGoal({ id: "G002", status: "pending" })] });

		// when
		const done = isUlwLoopDone(plan);

		// then
		expect(done).toBe(false);
	});

	it("treats superseded-with-complete-replacements as resolved", () => {
		// given
		const replacement = makeGoal({ id: "G002", status: "complete" });
		const superseded = makeGoal({
			id: "G001",
			status: "pending",
			steeringStatus: "superseded",
			supersededBy: [replacement.id],
		});
		const plan = makePlan({ goals: [superseded, replacement] });

		// when
		const done = isUlwLoopDone(plan);

		// then
		expect(done).toBe(true);
	});
});

describe("isFinalRunCompletionCandidate", () => {
	it("returns true when only one unresolved goal remains", () => {
		// given
		const finalGoal = makeGoal({ id: "G002", status: "pending" });
		const plan = makePlan({ goals: [makeGoal({ status: "complete" }), finalGoal] });

		// when
		const candidate = isFinalRunCompletionCandidate(plan, finalGoal);

		// then
		expect(candidate).toBe(true);
	});

	it("returns false when multiple unresolved", () => {
		// given
		const goal = makeGoal({ id: "G001", status: "pending" });
		const plan = makePlan({ goals: [goal, makeGoal({ id: "G002", status: "pending" })] });

		// when
		const candidate = isFinalRunCompletionCandidate(plan, goal);

		// then
		expect(candidate).toBe(false);
	});
});

describe("codexGoalMode", () => {
	it("defaults to per_story when undefined", () => {
		// when
		const mode = codexGoalMode(makePlan());

		// then
		expect(mode).toBe("per_story");
	});

	it("returns aggregate when explicitly aggregate", () => {
		// when
		const mode = codexGoalMode(makePlan({ codexGoalMode: "aggregate" }));

		// then
		expect(mode).toBe("aggregate");
	});
});

describe("expectedCodexObjective", () => {
	it("aggregate mode returns plan.codexObjective", () => {
		// given
		const goal = makeGoal({ objective: "story objective" });
		const plan = makePlan({ codexGoalMode: "aggregate", codexObjective: "aggregate objective" });

		// when
		const objective = expectedCodexObjective(plan, goal);

		// then
		expect(objective).toBe("aggregate objective");
	});

	it("aggregate mode falls back to ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE when codexObjective missing", () => {
		// given
		const goal = makeGoal({ objective: "story objective" });
		const plan = makePlan({ codexGoalMode: "aggregate" });

		// when
		const objective = expectedCodexObjective(plan, goal);

		// then
		expect(objective).toBe(ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE);
	});

	it("per_story mode returns goal.objective", () => {
		// given
		const goal = makeGoal({ objective: "story objective" });
		const plan = makePlan({ codexGoalMode: "per_story", codexObjective: "aggregate objective" });

		// when
		const objective = expectedCodexObjective(plan, goal);

		// then
		expect(objective).toBe("story objective");
	});
});

describe("aggregateCodexObjective", () => {
	it("returns plan.codexObjective when set", () => {
		// when
		const objective = aggregateCodexObjective(makePlan({ codexObjective: "aggregate objective" }));

		// then
		expect(objective).toBe("aggregate objective");
	});

	it("falls back to ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE", () => {
		// when
		const objective = aggregateCodexObjective(makePlan());

		// then
		expect(objective).toBe(ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE);
	});
});

describe("compatibleCodexObjectives", () => {
	it("includes aggregate objective + aliases", () => {
		// given
		const plan = makePlan({
			codexObjective: "aggregate objective",
			codexObjectiveAliases: ["legacy one", "legacy two"],
		});

		// when
		const objectives = compatibleCodexObjectives(plan);

		// then
		expect(objectives).toEqual(["aggregate objective", "legacy one", "legacy two"]);
	});
});

describe("hasAllCriteriaPass", () => {
	it("returns true when all criteria pass", () => {
		// given
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), makeCriterion({ id: "C002", status: "pass" })],
		});

		// when
		const passed = hasAllCriteriaPass(goal);

		// then
		expect(passed).toBe(true);
	});

	it("returns false when any criterion pending", () => {
		// given
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), makeCriterion({ id: "C002", status: "pending" })],
		});

		// when
		const passed = hasAllCriteriaPass(goal);

		// then
		expect(passed).toBe(false);
	});

	it("returns false when any criterion fail", () => {
		// given
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), makeCriterion({ id: "C002", status: "fail" })],
		});

		// when
		const passed = hasAllCriteriaPass(goal);

		// then
		expect(passed).toBe(false);
	});

	it("returns false when any criterion blocked", () => {
		// given
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), makeCriterion({ id: "C002", status: "blocked" })],
		});

		// when
		const passed = hasAllCriteriaPass(goal);

		// then
		expect(passed).toBe(false);
	});

	it("returns false for empty criteria array", () => {
		// when
		const passed = hasAllCriteriaPass(makeGoal({ successCriteria: [] }));

		// then
		expect(passed).toBe(false);
	});
});

describe("firstUnresolvedCriterion", () => {
	it("returns first non-pass criterion", () => {
		// given
		const unresolved = makeCriterion({ id: "C002", status: "fail" });
		const goal = makeGoal({ successCriteria: [makeCriterion({ status: "pass" }), unresolved] });

		// when
		const criterion = firstUnresolvedCriterion(goal);

		// then
		expect(criterion).toBe(unresolved);
	});

	it("returns undefined when all pass", () => {
		// given
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), makeCriterion({ id: "C002", status: "pass" })],
		});

		// when
		const criterion = firstUnresolvedCriterion(goal);

		// then
		expect(criterion).toBeUndefined();
	});

	it("returns first pending in mixed pass/pending/fail", () => {
		// given
		const pending = makeCriterion({ id: "C002", status: "pending" });
		const goal = makeGoal({
			successCriteria: [makeCriterion({ status: "pass" }), pending, makeCriterion({ id: "C003", status: "fail" })],
		});

		// when
		const criterion = firstUnresolvedCriterion(goal);

		// then
		expect(criterion).toBe(pending);
	});
});

describe("ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE", () => {
	it("references the .omo/ulw-loop path and excludes the legacy workspace", () => {
		const legacyWorkspace = [".", "om", "x"].join("");

		expect(ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE).toContain(".omo/ulw-loop");
		expect(ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE).not.toContain(legacyWorkspace);
	});
});
