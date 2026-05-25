import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ultragoalBriefPath, ultragoalGoalsPath, ultragoalLedgerPath } from "../src/paths.js";
import {
	addUltragoalGoal,
	createUltragoalPlan,
	deriveGoalCandidates,
	seedDefaultSuccessCriteria,
	startNextUltragoal,
	summarizeUltragoalPlan,
} from "../src/plan-crud.js";
import { writePlan } from "../src/plan-io.js";
import type { UltragoalItem, UltragoalPlan, UltragoalSuccessCriterion } from "../src/types.js";
import { UltragoalError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

async function makeRepo(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ug-crud-"));
}

async function readBriefFixture(): Promise<string> {
	return readFile(join(process.cwd(), "test", "fixtures", "sample-brief.md"), "utf8");
}

async function ledgerKinds(repoRoot: string): Promise<string[]> {
	const raw = await readFile(ultragoalLedgerPath(repoRoot), "utf8");
	return raw
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line).kind);
}

function criterion(status: UltragoalSuccessCriterion["status"]): UltragoalSuccessCriterion {
	const [base] = seedDefaultSuccessCriteria(0, "Implement auth endpoint");
	if (base === undefined) throw new Error("expected seeded criterion");
	return { ...base, status };
}

function makeGoal(overrides: Partial<UltragoalItem> = {}): UltragoalItem {
	return {
		id: "G001",
		title: "Build auth service",
		objective: "Implement JWT auth endpoint",
		status: "pending",
		successCriteria: seedDefaultSuccessCriteria(0, "Implement JWT auth endpoint"),
		attempt: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function makePlan(goals: UltragoalItem[]): UltragoalPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ultragoal/brief.md",
		goalsPath: ".omo/ultragoal/goals.json",
		ledgerPath: ".omo/ultragoal/ledger.jsonl",
		codexGoalMode: "aggregate",
		goals,
	};
}

function scheduled(result: Awaited<ReturnType<typeof startNextUltragoal>>) {
	if ("done" in result) throw new Error("expected scheduled goal");
	return result;
}

describe("seedDefaultSuccessCriteria", () => {
	it("produces 3 criteria with C001/C002/C003 ids", () => {
		const cs = seedDefaultSuccessCriteria(0, "Implement auth endpoint");
		expect(cs).toHaveLength(3);
		expect(cs.map((c) => c.id)).toEqual(["C001", "C002", "C003"]);
	});

	it("covers happy + edge + regression user models", () => {
		const cs = seedDefaultSuccessCriteria(0, "Implement auth endpoint");
		expect(cs.map((c) => c.userModel).sort()).toEqual(["edge", "happy", "regression"]);
	});

	it("seeds all criteria as pending with null capturedEvidence", () => {
		const cs = seedDefaultSuccessCriteria(0, "Implement auth endpoint");
		for (const c of cs) {
			expect(c.status).toBe("pending");
			expect(c.capturedEvidence).toBeNull();
		}
	});
});

describe("createUltragoalPlan", () => {
	it("creates .omo/ultragoal/{brief.md, goals.json, ledger.jsonl} in repoRoot", async () => {
		const repoRoot = await makeRepo();
		const brief = await readBriefFixture();

		await createUltragoalPlan(repoRoot, { brief });

		expect(await readFile(ultragoalBriefPath(repoRoot), "utf8")).toBe(brief.endsWith("\n") ? brief : `${brief}\n`);
		expect(await readFile(ultragoalGoalsPath(repoRoot), "utf8")).toContain("G001-build-the-jwt-auth-endpoint");
		expect(await ledgerKinds(repoRoot)).toEqual(["plan_created"]);
	});

	it("seeds at least 3 successCriteria per goal", async () => {
		const plan = await createUltragoalPlan(await makeRepo(), { brief: await readBriefFixture() });

		expect(plan.goals).toHaveLength(3);
		expect(plan.goals.every((goal) => goal.successCriteria.length >= 3)).toBe(true);
	});

	it("refuses overwrite of an existing plan without --force", async () => {
		const repoRoot = await makeRepo();
		await createUltragoalPlan(repoRoot, { brief: "first" });

		await expect(createUltragoalPlan(repoRoot, { brief: "second" })).rejects.toThrow(UltragoalError);
		await expect(createUltragoalPlan(repoRoot, { brief: "second" })).rejects.toThrow("Refusing to overwrite");
	});

	it("aggregate is the default codexGoalMode", async () => {
		const plan = await createUltragoalPlan(await makeRepo(), { brief: "Ship the feature" });

		expect(plan.codexGoalMode).toBe("aggregate");
		expect(plan.codexObjective).toContain(".omo/ultragoal/goals.json");
	});
});

describe("deriveGoalCandidates", () => {
	it("extracts bullets as goals", () => {
		expect(deriveGoalCandidates("# Brief\n\n- Build auth\n- Add tests")).toEqual([
			{ title: "Build auth", objective: "Build auth" },
			{ title: "Add tests", objective: "Add tests" },
		]);
	});

	it("falls back to paragraph parsing when no bullets", () => {
		expect(deriveGoalCandidates("First objective.\n\nSecond objective.").map((goal) => goal.objective)).toEqual([
			"First objective.",
			"Second objective.",
		]);
	});

	it("returns single default goal for empty/whitespace brief", () => {
		expect(deriveGoalCandidates(" \n\t ")).toEqual([
			{ title: "Complete the requested project objective.", objective: "Complete the requested project objective." },
		]);
	});
});

describe("addUltragoalGoal", () => {
	it("appends a new goal to plan with seeded successCriteria", async () => {
		const repoRoot = await makeRepo();
		await createUltragoalPlan(repoRoot, { brief: "Build auth" });

		const { plan, goal } = await addUltragoalGoal(repoRoot, { title: "Add rate limit", objective: "Throttle login" });

		expect(plan.goals).toHaveLength(2);
		expect(goal.id).toBe("G002-add-rate-limit");
		expect(goal.successCriteria).toHaveLength(3);
	});

	it("appends a ledger entry for goal_added", async () => {
		const repoRoot = await makeRepo();
		await createUltragoalPlan(repoRoot, { brief: "Build auth" });

		await addUltragoalGoal(repoRoot, { title: "Add rate limit", objective: "Throttle login" });

		expect(await ledgerKinds(repoRoot)).toEqual(["plan_created", "goal_added"]);
	});
});

describe("startNextUltragoal", () => {
	it("picks the first pending goal", async () => {
		const repoRoot = await makeRepo();
		await createUltragoalPlan(repoRoot, { brief: "- First\n- Second" });

		const result = scheduled(await startNextUltragoal(repoRoot, {}));

		expect(result.goal.id).toBe("G001-first");
		expect(result.goal.status).toBe("in_progress");
		expect(result.resumed).toBe(false);
	});

	it("resumes the in_progress goal when one exists", async () => {
		const repoRoot = await makeRepo();
		const plan = await createUltragoalPlan(repoRoot, { brief: "- First\n- Second" });
		const active = makeGoal({ ...plan.goals[1], status: "in_progress" });
		await writePlan(repoRoot, { ...plan, goals: [makeGoal({ ...plan.goals[0] }), active], activeGoalId: active.id });

		const result = scheduled(await startNextUltragoal(repoRoot, {}));

		expect(result.goal.id).toBe(active.id);
		expect(result.resumed).toBe(true);
	});

	it("with retryFailed picks first failed (non-blocked) goal", async () => {
		const repoRoot = await makeRepo();
		const failed = makeGoal({ status: "failed", failureReason: "flake" });
		await mkdir(join(repoRoot, ".omo", "ultragoal"), { recursive: true });
		await writePlan(repoRoot, makePlan([failed]));

		const result = scheduled(await startNextUltragoal(repoRoot, { retryFailed: true }));

		expect(result.goal.id).toBe("G001");
		expect(result.goal.attempt).toBe(1);
		expect(await ledgerKinds(repoRoot)).toEqual(["goal_retried", "goal_started"]);
	});

	it("returns { done: true } when no eligible goals remain", async () => {
		const repoRoot = await makeRepo();
		await mkdir(join(repoRoot, ".omo", "ultragoal"), { recursive: true });
		await writePlan(repoRoot, makePlan([makeGoal({ status: "complete" })]));

		const result = await startNextUltragoal(repoRoot, {});

		expect(result).toMatchObject({ done: true });
	});
});

describe("summarizeUltragoalPlan", () => {
	it("counts goals by status", () => {
		const plan = makePlan([
			makeGoal({ id: "G001", status: "pending" }),
			makeGoal({ id: "G002", status: "in_progress" }),
			makeGoal({ id: "G003", status: "complete" }),
			makeGoal({ id: "G004", status: "failed" }),
			makeGoal({ id: "G005", status: "blocked", steeringStatus: "blocked" }),
			makeGoal({ id: "G006", status: "review_blocked" }),
			makeGoal({ id: "G007", status: "needs_user_decision", steeringStatus: "superseded" }),
		]);

		expect(summarizeUltragoalPlan(plan)).toMatchObject({
			total: 7,
			pending: 1,
			in_progress: 1,
			complete: 1,
			failed: 1,
			blocked: 1,
			review_blocked: 1,
			needs_user_decision: 1,
			superseded: 1,
		});
	});

	it("aggregates criteria pass/pending/fail/blocked across all goals", () => {
		const plan = makePlan([
			makeGoal({ successCriteria: [criterion("pass"), criterion("pending")] }),
			makeGoal({ id: "G002", successCriteria: [criterion("fail"), criterion("blocked"), criterion("pending")] }),
		]);

		expect(summarizeUltragoalPlan(plan).criteria).toEqual({ total: 5, pass: 1, pending: 2, fail: 1, blocked: 1 });
	});
});
