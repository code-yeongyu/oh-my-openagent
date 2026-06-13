// biome-ignore-all format: keep this port under the mandated pure LOC budget.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { aggregateCodexObjectiveForScope, isUlwLoopDone } from "./goal-status.js";
import { type UlwLoopScope, ulwLoopBriefPath, ulwLoopBriefRelativePath, ulwLoopDir, ulwLoopGoalsPath, ulwLoopGoalsRelativePath, ulwLoopLedgerPath, ulwLoopLedgerRelativePath } from "./paths.js";
import { appendLedger, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import type { UlwLoopCodexGoalMode, UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "./types.js";
import { iso, UlwLoopError } from "./types.js";

export type UlwLoopPlanSummary = { readonly total: number; readonly pending: number; readonly in_progress: number; readonly complete: number; readonly failed: number; readonly blocked: number; readonly review_blocked: number; readonly needs_user_decision: number; readonly superseded: number; readonly criteria: { readonly total: number; readonly pass: number; readonly pending: number; readonly fail: number; readonly blocked: number } };

function cleanLine(line: string): string { return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim(); }
function normalizeObjective(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function titleFromObjective(objective: string, fallback: string): string { const firstLine = objective.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? fallback; return firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine; }
function normalizeGoalId(title: string, index: number): string { const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/g, ""); return `G${String(index + 1).padStart(3, "0")}${slug ? `-${slug}` : ""}`; }
function assertNonEmpty(value: string | undefined, label: string): string { const trimmed = value?.trim(); if (!trimmed) throw new UlwLoopError(`Missing ${label}.`, "ULW_LOOP_ARGUMENT_MISSING"); return trimmed; }
function truncateObjective(objective: string): string { return objective.length > 80 ? `${objective.slice(0, 77).trimEnd()}...` : objective; }

export function seedDefaultSuccessCriteria(goalIndex: number, objective: string): UlwLoopSuccessCriterion[] {
	const subject = truncateObjective(normalizeObjective(objective) || `Goal ${goalIndex + 1}`);
	const rows = [
		["C001", "happy", `happy path for: ${subject}`, `Replace via revise_criterion with observable happy-path proof for goal ${goalIndex + 1}.`],
		["C002", "edge", "edge case (boundary/empty/malformed)", `Replace via revise_criterion with boundary or malformed-input proof for: ${subject}.`],
		["C003", "regression", "regression: adjacent surface still works", `Replace via revise_criterion with regression proof for neighboring behavior after: ${subject}.`],
	] as const;
	return rows.map(([id, userModel, scenario, expectedEvidence]) => ({ id, scenario, userModel, expectedEvidence, capturedEvidence: null, status: "pending" }));
}

export function deriveGoalCandidates(brief: string): Array<{ title: string; objective: string }> {
	const bulletGoals = brief.split(/\r?\n/).map((line) => ({ original: line, cleaned: normalizeObjective(cleanLine(line)) })).filter(({ cleaned }) => cleaned.length > 0 && cleaned.length <= 1200).filter(({ original, cleaned }, index, all) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(original) && all.findIndex((candidate) => candidate.cleaned === cleaned) === index).map(({ cleaned }) => cleaned);
	const paragraphs = brief.split(/\n\s*\n/).map(normalizeObjective).filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));
	const selected = (bulletGoals.length > 0 ? bulletGoals : paragraphs).length > 0 ? (bulletGoals.length > 0 ? bulletGoals : paragraphs) : ["Complete the requested project objective."];
	return selected.map((objective, index) => ({ title: titleFromObjective(objective, `Goal ${index + 1}`), objective }));
}

function makeGoal(title: string, objective: string, index: number, now: string): UlwLoopItem {
	const cleanTitle = assertNonEmpty(title, "title");
	const cleanObjective = assertNonEmpty(objective, "objective");
	return { id: normalizeGoalId(cleanTitle, index), title: cleanTitle, objective: cleanObjective, status: "pending", successCriteria: seedDefaultSuccessCriteria(index, cleanObjective), attempt: 0, createdAt: now, updatedAt: now };
}

function appendGoalToPlan(plan: UlwLoopPlan, title: string, objective: string, now: string): UlwLoopItem {
	const goal = makeGoal(title, objective, plan.goals.length, now);
	plan.goals.push(goal);
	plan.updatedAt = now;
	return goal;
}

function isScheduleEligible(goal: UlwLoopItem): boolean { return goal.steeringStatus !== "superseded" && goal.steeringStatus !== "blocked"; }

function clearGoalBlockerFields(goal: UlwLoopItem): void {
	for (const key of ["blockedReason", "blockerSignature", "blockerOccurrenceCount", "requiredExternalDecision", "nonRetriable", "failedAt", "failureReason"] as const) delete goal[key];
}

export async function createUlwLoopPlan(repoRoot: string, args: { brief: string; codexGoalMode?: UlwLoopCodexGoalMode; force?: boolean }, scope?: UlwLoopScope): Promise<UlwLoopPlan> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		if (!args.force && existsSync(ulwLoopGoalsPath(repoRoot, scope))) {
			const existing = await readUlwLoopPlan(repoRoot, scope);
			if (isUlwLoopDone(existing)) throw completedPlanExistsError(scope);
			throw new UlwLoopError(`Refusing to overwrite existing ${ulwLoopGoalsRelativePath(scope)}; pass --force to recreate it.`, "ULW_LOOP_PLAN_EXISTS");
		}
		const now = iso();
		const goals = deriveGoalCandidates(args.brief).map((goal, index) => makeGoal(goal.title, goal.objective, index, now));
		const plan: UlwLoopPlan = { version: 1, createdAt: now, updatedAt: now, briefPath: ulwLoopBriefRelativePath(scope), goalsPath: ulwLoopGoalsRelativePath(scope), ledgerPath: ulwLoopLedgerRelativePath(scope), codexGoalMode: args.codexGoalMode ?? "aggregate", goals };
		if (plan.codexGoalMode === "aggregate") plan.codexObjective = aggregateCodexObjectiveForScope(scope);
		await mkdir(ulwLoopDir(repoRoot, scope), { recursive: true });
		await writeFile(ulwLoopBriefPath(repoRoot, scope), args.brief.endsWith("\n") ? args.brief : `${args.brief}\n`, "utf8");
		await writePlan(repoRoot, plan, scope);
		await writeFile(ulwLoopLedgerPath(repoRoot, scope), "", "utf8");
		await appendLedger(repoRoot, { at: now, kind: "plan_created", message: `${goals.length} goal(s) created` }, scope);
		return plan;
	});
}

function completedPlanExistsError(scope?: UlwLoopScope): UlwLoopError {
	return new UlwLoopError(
		[
			`Existing ulw-loop aggregate is already complete at ${ulwLoopGoalsRelativePath(scope)}.`,
			"Start a new run with `omo ulw-loop create-goals --session-id <new-id> ...` to isolate fresh state.",
			"Use --force only when you intentionally want to overwrite the completed evidence.",
		].join(" "),
		"ULW_LOOP_PLAN_EXISTS_COMPLETE",
	);
}

export async function addUlwLoopGoal(repoRoot: string, args: { title: string; objective: string }, scope?: UlwLoopScope): Promise<{ plan: UlwLoopPlan; goal: UlwLoopItem }> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const now = iso();
		const goal = appendGoalToPlan(plan, args.title, args.objective, now);
		await writePlan(repoRoot, plan, scope);
		await appendLedger(repoRoot, { at: now, kind: "goal_added", goalId: goal.id, status: goal.status, message: goal.title }, scope);
		return { plan, goal };
	});
}

export async function startNextUlwLoop(repoRoot: string, args: { retryFailed?: boolean } = {}, scope?: UlwLoopScope): Promise<{ plan: UlwLoopPlan; goal: UlwLoopItem; resumed: boolean } | { done: true; plan: UlwLoopPlan }> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const now = iso();
		if (plan.aggregateCompletion?.status === "complete") return { done: true, plan };
		const existing = plan.goals.find((goal) => goal.status === "in_progress" && isScheduleEligible(goal));
		if (existing) return { plan, goal: existing, resumed: true };
		let next = plan.goals.find((goal) => goal.status === "pending" && isScheduleEligible(goal));
		if (!next && args.retryFailed) {
			next = plan.goals.find((goal) => goal.status === "failed" && !goal.nonRetriable && isScheduleEligible(goal));
			if (next) await appendLedger(repoRoot, { at: now, kind: "goal_retried", goalId: next.id, status: "pending", ...(next.failureReason ? { message: next.failureReason } : {}) }, scope);
		}
		if (!next) return { done: true, plan };
		next.status = "in_progress";
		next.attempt += 1;
		next.startedAt = now;
		clearGoalBlockerFields(next);
		next.updatedAt = now;
		plan.activeGoalId = next.id;
		plan.updatedAt = now;
		await writePlan(repoRoot, plan, scope);
		await appendLedger(repoRoot, { at: now, kind: "goal_started", goalId: next.id, status: next.status, message: `Attempt ${next.attempt}` }, scope);
		return { plan, goal: next, resumed: false };
	});
}

export function summarizeUlwLoopPlan(plan: UlwLoopPlan): UlwLoopPlanSummary {
	const countStatus = (status: UlwLoopItem["status"]): number => plan.goals.filter((goal) => goal.status === status).length;
	const countCriteria = (status: UlwLoopSuccessCriterion["status"]): number => plan.goals.reduce((sum, goal) => sum + goal.successCriteria.filter((criterion) => criterion.status === status).length, 0);
	return { total: plan.goals.length, pending: countStatus("pending"), in_progress: countStatus("in_progress"), complete: countStatus("complete"), failed: countStatus("failed"), blocked: countStatus("blocked"), review_blocked: countStatus("review_blocked"), needs_user_decision: countStatus("needs_user_decision"), superseded: plan.goals.filter((goal) => goal.steeringStatus === "superseded").length, criteria: { total: plan.goals.reduce((sum, goal) => sum + goal.successCriteria.length, 0), pass: countCriteria("pass"), pending: countCriteria("pending"), fail: countCriteria("fail"), blocked: countCriteria("blocked") } };
}
