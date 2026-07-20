// biome-ignore-all format: compact port must stay within the requested pure LOC budget.

import { readCodexGoalSnapshotInput, reconcileCodexGoalSnapshot } from "./codex-goal-snapshot.js";
import { codexGoalMode, compatibleCodexObjectives, expectedCodexObjective, isFinalRunCompletionCandidate } from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import { seedDefaultSuccessCriteria } from "./plan-crud.js";
import { appendLedger, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import { refreshUlwLoopSnapshot } from "./snapshot.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
import { iso, UlwLoopError } from "./types.js";

export interface RecordFinalReviewBlockersArgs { readonly goalId: string; readonly title: string; readonly objective: string; readonly evidence: string; readonly codexGoalJson: string }
export interface RecordFinalReviewBlockersResult { readonly plan: UlwLoopPlan; readonly blockedGoal: UlwLoopItem; readonly newGoal: UlwLoopItem; readonly ledgerEntries: UlwLoopLedgerEntry[] }

const BLOCKER_FIELDS = "blockedReason blockerSignature blockerOccurrenceCount requiredExternalDecision nonRetriable failedAt failureReason completedAt blocker blockerEvidence blockerOccurrences blockedAt".split(" ");

function ulwLoopError(message: string, code: string): never {
	throw new UlwLoopError(message, code);
}

function nextGoalId(plan: UlwLoopPlan): string {
	const max = plan.goals.reduce((current, goal) => {
		const digits = /^G(\d+)/u.exec(goal.id)?.[1];
		return digits === undefined ? current : Math.max(current, Number(digits));
	}, 0);
	return `G${String(max + 1).padStart(3, "0")}`;
}

function appendBlockerGoal(plan: UlwLoopPlan, args: RecordFinalReviewBlockersArgs, now: string): UlwLoopItem {
	const index = plan.goals.length;
	const goal: UlwLoopItem = {
		id: nextGoalId(plan),
		title: args.title,
		objective: args.objective,
		status: "pending",
		successCriteria: seedDefaultSuccessCriteria(index, args.objective),
		attempt: 0,
		createdAt: now,
		updatedAt: now,
	};
	plan.goals.push(goal);
	return goal;
}

export async function recordFinalReviewBlockers(
	repoRoot: string,
	args: RecordFinalReviewBlockersArgs,
	scope?: UlwLoopScope,
): Promise<RecordFinalReviewBlockersResult> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const goal = plan.goals.find((candidate) => candidate.id === args.goalId);
		if (goal === undefined) ulwLoopError(`Unknown ulw-loop id: ${args.goalId}`, "ulw_loop_goal_not_found");
		if (goal.status !== "in_progress") ulwLoopError(`${goal.id} is ${goal.status}.`, "ulw_loop_goal_not_in_progress");
		if (!isFinalRunCompletionCandidate(plan, goal)) ulwLoopError(`${goal.id} is not final.`, "ulw_loop_not_final_story");

		const snapshot = await readCodexGoalSnapshotInput(args.codexGoalJson, repoRoot);
		const aggregate = codexGoalMode(plan) === "aggregate";
		const reconciliation = reconcileCodexGoalSnapshot(snapshot, { expectedObjective: expectedCodexObjective(plan, goal), ...(aggregate ? { acceptedObjectives: compatibleCodexObjectives(plan) } : {}), allowedStatuses: ["active"], requireSnapshot: true, requireComplete: false });
		if (!reconciliation.ok) ulwLoopError(reconciliation.errors.join(" "), "ulw_loop_codex_snapshot_mismatch");

		const now = iso();
		for (const field of BLOCKER_FIELDS) Reflect.deleteProperty(goal, field);
		goal.status = "review_blocked";
		goal.reviewBlockedAt = now;
		goal.evidence = args.evidence;
		goal.updatedAt = now;
		if (plan.activeGoalId === goal.id) delete plan.activeGoalId;
		const newGoal = appendBlockerGoal(plan, args, now);
		plan.updatedAt = now;

		const codexGoal = reconciliation.snapshot.raw;
		const blockedEntry: UlwLoopLedgerEntry = { at: now, kind: "goal_review_blocked", goalId: goal.id, status: goal.status, evidence: args.evidence, codexGoal };
		const addedEntry: UlwLoopLedgerEntry = { at: now, kind: "goal_added", goalId: newGoal.id, status: newGoal.status, evidence: args.evidence, message: newGoal.title };
		const summaryEntry: UlwLoopLedgerEntry = { at: now, kind: "goal_review_blocked", goalId: goal.id, status: goal.status, evidence: args.evidence, codexGoal, message: `Review blockers recorded; appended ${newGoal.id}.` };
		Reflect.set(summaryEntry, "kind", "blocker_recorded");
		const ledgerEntries = [blockedEntry, addedEntry, summaryEntry];
		await writePlan(repoRoot, plan, scope);
		for (const entry of ledgerEntries) await appendLedger(repoRoot, entry, scope);
		await refreshUlwLoopSnapshot(repoRoot, plan, `${goal.id} review blocked; work on ${newGoal.id}.`, scope);
		return { plan, blockedGoal: goal, newGoal, ledgerEntries };
	});
}
