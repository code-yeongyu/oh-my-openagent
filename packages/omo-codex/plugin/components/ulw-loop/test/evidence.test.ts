import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	criteriaSummary,
	markCriteriaPendingResetForGoal,
	recordEvidence,
	unresolvedCriteriaOf,
} from "../src/evidence.js";
import { ulwLoopDir } from "../src/paths.js";
import { readUlwLoopPlan, writePlan } from "../src/plan-io.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSuccessCriterion } from "../src/types.js";
import { UlwLoopError } from "../src/types.js";

const NOW = "2026-05-23T00:00:00.000Z";

async function bootstrapRepo(plan: UlwLoopPlan): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-evidence-"));
	await mkdir(ulwLoopDir(repo), { recursive: true });
	await writePlan(repo, plan);
	return repo;
}

async function readLastLedgerEntry(repo: string): Promise<UlwLoopLedgerEntry> {
	const lines = (await readFile(join(repo, ".omo/ulw-loop/ledger.jsonl"), "utf8")).trim().split("\n");
	const last = lines.at(-1);
	if (last === undefined) throw new Error("expected ledger entry");
	return JSON.parse(last);
}

async function readLatestSnapshot(repo: string): Promise<string> {
	return readFile(join(repo, ".omo/ulw-loop/snapshots/latest.md"), "utf8");
}

function firstGoal(plan: UlwLoopPlan): UlwLoopItem {
	const goal = plan.goals.at(0);
	if (goal === undefined) throw new Error("expected goal");
	return goal;
}

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

function makePlan(overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	return {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		codexGoalMode: "aggregate",
		codexObjective: "Complete the durable ulw-loop plan in .omo/ulw-loop/goals.json",
		codexObjectiveAliases: [],
		goals: [makeGoal()],
		...overrides,
	};
}

describe("recordEvidence (status=pass)", () => {
	it("sets criterion.status=pass + capturedEvidence + capturedAt", async () => {
		const repo = await bootstrapRepo(makePlan());

		const result = await recordEvidence(repo, {
			goalId: "G001",
			criterionId: "C001",
			status: "pass",
			evidence: "curl /login returns 200 + token verified",
		});

		expect(result.criterion.status).toBe("pass");
		expect(result.criterion.capturedEvidence).toContain("curl /login returns 200");
		expect(result.criterion.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("appends evidence_captured ledger event", async () => {
		const repo = await bootstrapRepo(makePlan());

		await recordEvidence(repo, { goalId: "G001", criterionId: "C001", status: "pass", evidence: "observable proof" });

		const last = await readLastLedgerEntry(repo);
		expect(last.kind).toBe("evidence_captured");
		expect(last.goalId).toBe("G001");
		expect(last.criterionId).toBe("C001");
	});

	it("persists the change so a fresh read sees status=pass", async () => {
		const repo = await bootstrapRepo(makePlan());

		await recordEvidence(repo, { goalId: "G001", criterionId: "C001", status: "pass", evidence: "observable proof" });

		const criterion = firstGoal(await readUlwLoopPlan(repo)).successCriteria.find((c) => c.id === "C001");
		expect(criterion?.status).toBe("pass");
	});

	it("#given evidence is recorded #when reading the resume snapshot #then it includes criteria summary and evidence", async () => {
		const repo = await bootstrapRepo(makePlan());

		await recordEvidence(repo, { goalId: "G001", criterionId: "C001", status: "pass", evidence: "observable proof" });

		const snapshot = await readLatestSnapshot(repo);
		expect(snapshot).toContain("- pass: 1");
		expect(snapshot).toContain("G001/C001 [pass] observable proof");
	});
});

describe("recordEvidence (status=fail)", () => {
	it("sets criterion.status=fail + appends criterion_failed event", async () => {
		const repo = await bootstrapRepo(makePlan());

		const result = await recordEvidence(repo, {
			goalId: "G001",
			criterionId: "C001",
			status: "fail",
			evidence: "got 500 not 200",
		});

		expect(result.criterion.status).toBe("fail");
		expect((await readLastLedgerEntry(repo)).kind).toBe("criterion_failed");
	});
});

describe("recordEvidence (status=blocked)", () => {
	it("sets criterion.status=blocked + appends criterion_blocked event", async () => {
		const repo = await bootstrapRepo(makePlan());

		const result = await recordEvidence(repo, {
			goalId: "G001",
			criterionId: "C001",
			status: "blocked",
			evidence: "auth not in CI yet",
		});

		expect(result.criterion.status).toBe("blocked");
		expect((await readLastLedgerEntry(repo)).kind).toBe("criterion_blocked");
	});
});

describe("recordEvidence error cases", () => {
	it("throws when goalId not found", async () => {
		const repo = await bootstrapRepo(makePlan());

		await expect(
			recordEvidence(repo, { goalId: "GUNKNOWN", criterionId: "C001", status: "pass", evidence: "x" }),
		).rejects.toBeInstanceOf(UlwLoopError);
	});

	it("throws when criterionId not found within goal", async () => {
		const repo = await bootstrapRepo(makePlan());

		await expect(
			recordEvidence(repo, { goalId: "G001", criterionId: "CUNKNOWN", status: "pass", evidence: "x" }),
		).rejects.toBeInstanceOf(UlwLoopError);
	});

	it("throws when evidence is empty/whitespace", async () => {
		const repo = await bootstrapRepo(makePlan());

		await expect(
			recordEvidence(repo, { goalId: "G001", criterionId: "C001", status: "pass", evidence: "   " }),
		).rejects.toBeInstanceOf(UlwLoopError);
	});
});

describe("markCriteriaPendingResetForGoal", () => {
	it("resets every criterion of the goal to pending + capturedEvidence=null", async () => {
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass", capturedEvidence: "old" }),
				makeCriterion({ id: "C002", status: "fail", capturedEvidence: "older" }),
				makeCriterion({ id: "C003", status: "blocked", capturedEvidence: "oldest" }),
			],
		});
		const repo = await bootstrapRepo(makePlan({ goals: [goal] }));

		const result = await markCriteriaPendingResetForGoal(repo, "G001");

		expect(result.resetCount).toBe(3);
		for (const c of firstGoal(result.plan).successCriteria) {
			expect(c.status).toBe("pending");
			expect(c.capturedEvidence).toBeNull();
		}
	});

	it("appends a single criteria_revised ledger event describing the reset", async () => {
		const repo = await bootstrapRepo(makePlan());

		await markCriteriaPendingResetForGoal(repo, "G001");

		expect((await readLastLedgerEntry(repo)).kind).toBe("criteria_revised");
	});

	it("#given criteria are reset #when reading the resume snapshot #then it reflects pending criteria", async () => {
		const goal = makeGoal({
			successCriteria: [makeCriterion({ id: "C001", status: "pass", capturedEvidence: "old evidence" })],
		});
		const repo = await bootstrapRepo(makePlan({ goals: [goal] }));

		await markCriteriaPendingResetForGoal(repo, "G001");

		const snapshot = await readLatestSnapshot(repo);
		expect(snapshot).toContain("- pending: 1");
		expect(snapshot).not.toContain("old evidence");
	});
});

describe("criteriaSummary (pure)", () => {
	it("aggregates counts across all goals", () => {
		const plan = makePlan({
			goals: [
				makeGoal({
					id: "G001",
					successCriteria: [
						makeCriterion({ id: "C001", status: "pass" }),
						makeCriterion({ id: "C002", status: "pending" }),
					],
				}),
				makeGoal({
					id: "G002",
					successCriteria: [
						makeCriterion({ id: "C001", status: "fail" }),
						makeCriterion({ id: "C002", status: "blocked" }),
						makeCriterion({ id: "C003", status: "pass" }),
					],
				}),
			],
		});

		const summary = criteriaSummary(plan);

		expect(summary.totalCriteria).toBe(5);
		expect(summary.passCount).toBe(2);
		expect(summary.pendingCount).toBe(1);
		expect(summary.failCount).toBe(1);
		expect(summary.blockedCount).toBe(1);
		expect(summary.goalsWithUnresolvedCriteria).toEqual(["G001", "G002"]);
	});

	it("returns empty when no criteria exist", () => {
		const summary = criteriaSummary(makePlan({ goals: [makeGoal({ successCriteria: [] })] }));

		expect(summary.totalCriteria).toBe(0);
		expect(summary.goalsWithUnresolvedCriteria).toEqual([]);
	});
});

describe("unresolvedCriteriaOf (pure)", () => {
	it("returns only non-pass criteria", () => {
		const goal = makeGoal({
			successCriteria: [
				makeCriterion({ id: "C001", status: "pass" }),
				makeCriterion({ id: "C002", status: "pending" }),
				makeCriterion({ id: "C003", status: "fail" }),
			],
		});

		const unresolved = unresolvedCriteriaOf(goal);

		expect(unresolved.map((c) => c.id)).toEqual(["C002", "C003"]);
	});
});
