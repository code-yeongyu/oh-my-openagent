import { describe, expect, it } from "vitest";

import { buildCodexGoalInstruction } from "../src/codex-goal-instruction.js";
import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const FINAL_REVIEW_ROLES = ["lazycodex-code-reviewer", "lazycodex-qa-executor", "lazycodex-gate-reviewer"] as const;
const QUALITY_GATE_SECTIONS = ["codeReview", "manualQa", "gateReview", "iteration", "criteriaCoverage"] as const;

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

function expectTextToContainAll(text: string, terms: readonly string[]): void {
	for (const term of terms) expect(text).toContain(term);
}

describe("buildCodexGoalInstruction aggregate mode", () => {
	it("references the aggregate handoff and the .omo/ulw-loop/goals.json artifact", () => {
		const { text } = buildCodexGoalInstruction({ plan: makePlan({ codexGoalMode: "aggregate" }), goal: makeGoal() });
		expect(text).toContain("aggregate");
		expect(text).toContain(".omo/ulw-loop/goals.json");
	});

	it("given aggregate mode when rendering create_goal payload then omits numeric limits", () => {
		const { json, text } = buildCodexGoalInstruction({
			plan: makePlan({ codexGoalMode: "aggregate" }),
			goal: makeGoal(),
		});
		expect(json).toEqual({
			objective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE,
		});
		expect(text).toContain("objective only");
		expect(text).not.toContain('"status"');
		expect(text).toContain("Goals are unlimited");
		expect(text).not.toMatch(/token[_-]?budget/i);
	});

	it("instructs not to call update_goal mid-aggregate when not final", () => {
		const { text } = buildCodexGoalInstruction({
			plan: makePlan({ codexGoalMode: "aggregate" }),
			goal: makeGoal(),
			isFinal: false,
		});
		expect(text).toContain("do not call update_goal mid-aggregate");
		expect(text).toContain("checkpoint this OMO ledger story");
		expect(text).toContain("update_goal is reserved for the final story after the mandatory quality gate passes");
	});

	it("#given a non-final aggregate story #when rendering instructions #then defers the current final quality gate", () => {
		const { text } = buildCodexGoalInstruction({
			plan: makePlan({ codexGoalMode: "aggregate" }),
			goal: makeGoal(),
			isFinal: false,
		});

		expect(text).toMatch(/not the final .*do not run .*quality gate/i);
		expect(text).toContain("checkpoint this OMO ledger story");
		expect(text).toContain("continue the remaining stories");
	});

	it("includes quality gate instruction when isFinal", () => {
		const { text } = buildCodexGoalInstruction({
			plan: makePlan({ codexGoalMode: "aggregate" }),
			goal: makeGoal(),
			isFinal: true,
		});
		expect(text).toMatch(/quality gate/i);
	});

	it("#given a final aggregate story #when rendering instructions #then requires the current LazyCodex quality gate", () => {
		const { text } = buildCodexGoalInstruction({
			plan: makePlan({ codexGoalMode: "aggregate" }),
			goal: makeGoal(),
			isFinal: true,
		});

		expectTextToContainAll(text, FINAL_REVIEW_ROLES);
		expectTextToContainAll(text, QUALITY_GATE_SECTIONS);
		expect(text).toMatch(/targeted verification/i);
		expect(text).toMatch(/artifact path.*non-zero size/i);
		expect(text).toMatch(/not clean.*do not call update_goal/i);
		expect(text).toContain("record-review-blockers");
		expect(text).toContain("checkpoint");
	});

	it("#given a scoped plan #when rendering final commands #then includes the session id option", () => {
		const { text } = buildCodexGoalInstruction({
			plan: makePlan({
				codexGoalMode: "aggregate",
				goalsPath: ".omo/ulw-loop/session-A/goals.json",
				ledgerPath: ".omo/ulw-loop/session-A/ledger.jsonl",
			}),
			goal: makeGoal(),
			isFinal: true,
		});

		expect(text).toContain("record-review-blockers --session-id session-A");
		expect(text).toContain("checkpoint --session-id session-A");
		expect(text).toContain("complete-goals --session-id session-A --retry-failed");
	});
});

describe("buildCodexGoalInstruction per_story mode", () => {
	it("uses the goal's own objective for create_goal", () => {
		const goal = makeGoal({ objective: "Build the auth service" });
		const { text } = buildCodexGoalInstruction({ plan: makePlan({ codexGoalMode: "per_story" }), goal });
		expect(text).toContain("Build the auth service");
	});
});

describe("buildCodexGoalInstruction criteria section", () => {
	it("lists every successCriteria entry with id + scenario + status", () => {
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({
					id: "C001",
					scenario: "happy login",
					userModel: "happy",
					expectedEvidence: "200 OK",
					status: "pending",
				}),
				makeCriterion({
					id: "C002",
					scenario: "invalid creds",
					userModel: "edge",
					expectedEvidence: "401",
					status: "pass",
				}),
				makeCriterion({
					id: "C003",
					scenario: "no regression /health",
					userModel: "regression",
					expectedEvidence: "/health unaffected",
					status: "fail",
				}),
			],
		});

		const { text } = buildCodexGoalInstruction({ plan: makePlan(), goal });

		expect(text).toContain("C001");
		expect(text).toContain("happy login");
		expect(text).toContain("pending");
		expect(text).toContain("C002");
		expect(text).toContain("pass");
		expect(text).toContain("C003");
		expect(text).toContain("fail");
	});

	it("highlights pending criteria as remaining work", () => {
		const goal = makeGoal({ successCriteria: [makeCriterion({ id: "C001", status: "pending" })] });
		const { text } = buildCodexGoalInstruction({ plan: makePlan(), goal });
		expect(text).toMatch(/remaining|pending/i);
	});
});

describe("buildCodexGoalInstruction artifact guidance", () => {
	it("references .omo/ulw-loop in artifact paths", () => {
		const { text } = buildCodexGoalInstruction({ plan: makePlan({ codexGoalMode: "aggregate" }), goal: makeGoal() });
		expect(text).toContain(".omo/ulw-loop");
	});
});
