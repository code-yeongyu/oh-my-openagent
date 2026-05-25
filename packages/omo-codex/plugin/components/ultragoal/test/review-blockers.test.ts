import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE } from "../src/goal-status.js";
import { ultragoalDir, ultragoalLedgerPath } from "../src/paths.js";
import { writePlan } from "../src/plan-io.js";
import { recordFinalReviewBlockers } from "../src/review-blockers.js";
import type { UltragoalItem, UltragoalPlan, UltragoalSuccessCriterion } from "../src/types.js";
import { UltragoalError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";
const VALID_SNAPSHOT_JSON = JSON.stringify({
	goal: { objective: ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE, status: "active" },
});

const validArgs = {
	goalId: "G002",
	title: "Resolve final code-review blockers",
	objective: "Address the BLOCK findings from the architect",
	evidence: "review verdict: REQUEST_CHANGES (3 issues)",
	codexGoalJson: VALID_SNAPSHOT_JSON,
};

function makeCriterion(overrides: Partial<UltragoalSuccessCriterion> = {}): UltragoalSuccessCriterion {
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

function makeGoal(overrides: Partial<UltragoalItem> = {}): UltragoalItem {
	return {
		id: "G001",
		title: "Build durable plan",
		objective: "Complete one ultragoal story",
		status: "pending",
		successCriteria: [makeCriterion()],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makePlan(overrides: Partial<UltragoalPlan> = {}): UltragoalPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ultragoal/brief.md",
		goalsPath: ".omo/ultragoal/goals.json",
		ledgerPath: ".omo/ultragoal/ledger.jsonl",
		codexGoalMode: "aggregate",
		codexObjective: ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE,
		goals: [makeGoal({ status: "in_progress" })],
		...overrides,
	};
}

async function bootstrapRepo(plan: UltragoalPlan): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-review-blockers-"));
	await mkdir(ultragoalDir(repo), { recursive: true });
	await writePlan(repo, plan);
	return repo;
}

async function ledgerKinds(repo: string): Promise<string[]> {
	const raw = await readFile(ultragoalLedgerPath(repo), "utf8");
	return raw
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line).kind);
}

async function expectUltragoalCode(action: () => Promise<unknown>, code: string): Promise<void> {
	try {
		await action();
	} catch (error) {
		expect(error).toBeInstanceOf(UltragoalError);
		if (!(error instanceof UltragoalError)) throw error;
		expect(error.code).toBe(code);
		return;
	}
	throw new Error("Expected UltragoalError");
}

function finalPlan(): UltragoalPlan {
	return makePlan({
		activeGoalId: "G002",
		goals: [
			makeGoal({ id: "G001", status: "complete" }),
			makeGoal({ id: "G002", status: "in_progress", title: "ship it", objective: "Finish final story" }),
		],
	});
}

describe("recordFinalReviewBlockers happy path", () => {
	it("marks the final goal review_blocked + appends new pending goal", async () => {
		const repo = await bootstrapRepo(finalPlan());

		const result = await recordFinalReviewBlockers(repo, validArgs);

		expect(result.blockedGoal.status).toBe("review_blocked");
		expect(result.blockedGoal.evidence).toBe(validArgs.evidence);
		expect(result.newGoal).toMatchObject({ id: "G003", status: "pending", title: validArgs.title });
		expect(result.newGoal.successCriteria.length).toBeGreaterThanOrEqual(3);
		expect(result.plan.activeGoalId).toBeUndefined();
		expect(result.ledgerEntries.length).toBeGreaterThanOrEqual(3);
	});

	it("seeded successCriteria cover happy/edge/regression on the blocker-resolution goal", async () => {
		const repo = await bootstrapRepo(finalPlan());

		const result = await recordFinalReviewBlockers(repo, validArgs);

		expect(result.newGoal.successCriteria.map((criterion) => criterion.userModel).sort()).toEqual([
			"edge",
			"happy",
			"regression",
		]);
	});
});

describe("recordFinalReviewBlockers error cases", () => {
	it("throws ultragoal_goal_not_found for unknown goalId", async () => {
		const repo = await bootstrapRepo(finalPlan());
		await expectUltragoalCode(
			() => recordFinalReviewBlockers(repo, { ...validArgs, goalId: "G999" }),
			"ultragoal_goal_not_found",
		);
	});

	it("throws ultragoal_goal_not_in_progress when goal.status !== in_progress", async () => {
		const repo = await bootstrapRepo(
			makePlan({
				goals: [makeGoal({ id: "G001", status: "in_progress" }), makeGoal({ id: "G002", status: "pending" })],
			}),
		);
		await expectUltragoalCode(() => recordFinalReviewBlockers(repo, validArgs), "ultragoal_goal_not_in_progress");
	});

	it("throws ultragoal_not_final_story when other unresolved goals remain", async () => {
		const repo = await bootstrapRepo(
			makePlan({
				goals: [makeGoal({ id: "G001", status: "in_progress" }), makeGoal({ id: "G002", status: "pending" })],
			}),
		);
		await expectUltragoalCode(
			() => recordFinalReviewBlockers(repo, { ...validArgs, goalId: "G001" }),
			"ultragoal_not_final_story",
		);
	});

	it("throws ultragoal_codex_snapshot_mismatch when objective mismatches", async () => {
		const repo = await bootstrapRepo(finalPlan());
		const codexGoalJson = JSON.stringify({ goal: { objective: "wrong", status: "active" } });

		await expectUltragoalCode(
			() => recordFinalReviewBlockers(repo, { ...validArgs, codexGoalJson }),
			"ultragoal_codex_snapshot_mismatch",
		);
	});
});

describe("recordFinalReviewBlockers ledger entries", () => {
	it("appends goal_review_blocked + goal_added + blocker_recorded events", async () => {
		const repo = await bootstrapRepo(finalPlan());

		await recordFinalReviewBlockers(repo, validArgs);

		expect(await ledgerKinds(repo)).toEqual(["goal_review_blocked", "goal_added", "blocker_recorded"]);
	});
});
