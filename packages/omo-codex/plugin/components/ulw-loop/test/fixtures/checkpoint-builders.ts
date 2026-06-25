import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import { ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE } from "../../src/goal-status.js";
import { ulwLoopDir, ulwLoopLedgerPath } from "../../src/paths.js";
import { writePlan } from "../../src/plan-io.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSuccessCriterion } from "../../src/types.js";
import { UlwLoopError } from "../../src/types.js";

export const NOW = "2026-05-23T00:00:00.000Z";

export function criterion(
	id: string,
	status: UlwLoopSuccessCriterion["status"],
	overrides: Partial<UlwLoopSuccessCriterion> = {},
): UlwLoopSuccessCriterion {
	return {
		id,
		scenario: `${id} scenario`,
		userModel: "happy",
		expectedEvidence: `${id} proof`,
		capturedEvidence: status === "pass" ? `${id} passed` : null,
		status,
		...overrides,
	};
}

export function goal(overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return {
		id: "G001",
		title: "Build auth",
		objective: "Implement JWT auth endpoint",
		status: "in_progress",
		successCriteria: [criterion("C001", "pass"), criterion("C002", "pass"), criterion("C003", "pass")],
		attempt: 1,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

export function plan(goals: UlwLoopItem[], overrides: Partial<UlwLoopPlan> = {}): UlwLoopPlan {
	const result: UlwLoopPlan = {
		version: 1,
		createdAt: NOW,
		updatedAt: NOW,
		briefPath: ".omo/ulw-loop/brief.md",
		goalsPath: ".omo/ulw-loop/goals.json",
		ledgerPath: ".omo/ulw-loop/ledger.jsonl",
		codexGoalMode: "aggregate",
		codexObjective: ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE,
		goals,
	};
	Object.assign(result, overrides);
	const activeGoalId = goals.find((candidate) => candidate.status === "in_progress")?.id;
	if (result.activeGoalId === undefined && activeGoalId !== undefined) result.activeGoalId = activeGoalId;
	return result;
}

export async function repoWith(seed: UlwLoopPlan): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "ug-checkpoint-"));
	await mkdir(ulwLoopDir(repo), { recursive: true });
	await writePlan(repo, seed);
	return repo;
}

export function snapshot(status: "active" | "complete", objective = ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE): string {
	return JSON.stringify({ goal: { objective, status } });
}

export async function lastLedger(repo: string): Promise<UlwLoopLedgerEntry> {
	const last = (await readFile(ulwLoopLedgerPath(repo), "utf8")).trim().split(/\r?\n/).at(-1);
	if (last === undefined) throw new Error("expected ledger entry");
	const entry: UlwLoopLedgerEntry = JSON.parse(last);
	return entry;
}

export async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
	try {
		await action();
	} catch (error) {
		expect(error).toBeInstanceOf(UlwLoopError);
		if (!(error instanceof UlwLoopError)) throw error;
		expect(error.code).toBe(code);
		return;
	}
	throw new Error("Expected UlwLoopError");
}

export function passGoal(id: string, overrides: Partial<UlwLoopItem> = {}): UlwLoopItem {
	return goal({
		id,
		successCriteria: [criterion("C001", "pass"), criterion("C002", "pass"), criterion("C003", "pass")],
		...overrides,
	});
}
