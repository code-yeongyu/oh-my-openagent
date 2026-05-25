// biome-ignore-all format: compact port must stay within the requested pure LOC budget.

import { readCodexGoalSnapshotInput, reconcileCodexGoalSnapshot } from "./codex-goal-snapshot.js";
import { codexGoalMode, compatibleCodexObjectives, expectedCodexObjective, isFinalRunCompletionCandidate } from "./goal-status.js";
import { seedDefaultSuccessCriteria } from "./plan-crud.js";
import { appendLedger, readUltragoalPlan, withUltragoalMutationLock, writePlan } from "./plan-io.js";
import type { UltragoalItem, UltragoalLedgerEntry, UltragoalPlan } from "./types.js";
import { iso, UltragoalError } from "./types.js";

export interface RecordFinalReviewBlockersArgs { readonly goalId: string; readonly title: string; readonly objective: string; readonly evidence: string; readonly codexGoalJson: string }
export interface RecordFinalReviewBlockersResult { readonly plan: UltragoalPlan; readonly blockedGoal: UltragoalItem; readonly newGoal: UltragoalItem; readonly ledgerEntries: UltragoalLedgerEntry[] }

const BLOCKER_FIELDS = "blockedReason blockerSignature blockerOccurrenceCount requiredExternalDecision nonRetriable failedAt failureReason completedAt blocker blockerEvidence blockerOccurrences blockedAt".split(" ");

function ultragoalError(message: string, code: string): never {
	throw new UltragoalError(message, code);
}

function nextGoalId(plan: UltragoalPlan): string {
	const max = plan.goals.reduce((current, goal) => {
		const digits = /^G(\d+)/u.exec(goal.id)?.[1];
		return digits === undefined ? current : Math.max(current, Number(digits));
	}, 0);
	return `G${String(max + 1).padStart(3, "0")}`;
}

function appendBlockerGoal(plan: UltragoalPlan, args: RecordFinalReviewBlockersArgs, now: string): UltragoalItem {
	const index = plan.goals.length;
	const goal: UltragoalItem = {
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
): Promise<RecordFinalReviewBlockersResult> {
	return withUltragoalMutationLock(repoRoot, async () => {
		const plan = await readUltragoalPlan(repoRoot);
		const goal = plan.goals.find((candidate) => candidate.id === args.goalId);
		if (goal === undefined) ultragoalError(`Unknown ultragoal id: ${args.goalId}`, "ultragoal_goal_not_found");
		if (goal.status !== "in_progress") ultragoalError(`${goal.id} is ${goal.status}.`, "ultragoal_goal_not_in_progress");
		if (!isFinalRunCompletionCandidate(plan, goal)) ultragoalError(`${goal.id} is not final.`, "ultragoal_not_final_story");

		const snapshot = await readCodexGoalSnapshotInput(args.codexGoalJson, repoRoot);
		const aggregate = codexGoalMode(plan) === "aggregate";
		const reconciliation = reconcileCodexGoalSnapshot(snapshot, { expectedObjective: expectedCodexObjective(plan, goal), ...(aggregate ? { acceptedObjectives: compatibleCodexObjectives(plan) } : {}), allowedStatuses: ["active"], requireSnapshot: true, requireComplete: false });
		if (!reconciliation.ok) ultragoalError(reconciliation.errors.join(" "), "ultragoal_codex_snapshot_mismatch");

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
		const blockedEntry: UltragoalLedgerEntry = { at: now, kind: "goal_review_blocked", goalId: goal.id, status: goal.status, evidence: args.evidence, codexGoal };
		const addedEntry: UltragoalLedgerEntry = { at: now, kind: "goal_added", goalId: newGoal.id, status: newGoal.status, evidence: args.evidence, message: newGoal.title };
		const summaryEntry: UltragoalLedgerEntry = { at: now, kind: "goal_review_blocked", goalId: goal.id, status: goal.status, evidence: args.evidence, codexGoal, message: `Review blockers recorded; appended ${newGoal.id}.` };
		Reflect.set(summaryEntry, "kind", "blocker_recorded");
		const ledgerEntries = [blockedEntry, addedEntry, summaryEntry];
		await writePlan(repoRoot, plan);
		for (const entry of ledgerEntries) await appendLedger(repoRoot, entry);
		return { plan, blockedGoal: goal, newGoal, ledgerEntries };
	});
}
