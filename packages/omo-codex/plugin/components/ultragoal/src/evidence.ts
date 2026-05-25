// biome-ignore-all format: keep this module under the mandated pure LOC budget.
import { hasAllCriteriaPass } from "./goal-status.js";
import { appendLedger, readUltragoalPlan, withUltragoalMutationLock, writePlan } from "./plan-io.js";
import type { UltragoalItem, UltragoalLedgerEntry, UltragoalPlan, UltragoalSuccessCriterion } from "./types.js";
import { iso, UltragoalError } from "./types.js";

type EvidenceStatus = "pass" | "fail" | "blocked";
type RecordEvidenceArgs = { readonly goalId: string; readonly criterionId: string; readonly status: EvidenceStatus; readonly evidence: string; readonly notes?: string };

function ultragoalFail(message: string, code: string, details: Record<string, unknown>): never { throw new UltragoalError(message, code, { details }); }

function ledgerKind(status: EvidenceStatus): UltragoalLedgerEntry["kind"] {
	switch (status) {
		case "pass":
			return "evidence_captured";
		case "fail":
			return "criterion_failed";
		case "blocked":
			return "criterion_blocked";
		default:
			return ultragoalFail("Invalid criterion status.", "ULTRAGOAL_CRITERION_STATUS_INVALID", { status });
	}
}

function findGoal(plan: UltragoalPlan, goalId: string): UltragoalItem {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	return goal ?? ultragoalFail(`Ultragoal goal not found: ${goalId}.`, "ULTRAGOAL_GOAL_NOT_FOUND", { goalId });
}

function findCriterion(goal: UltragoalItem, criterionId: string): UltragoalSuccessCriterion {
	const criterion = goal.successCriteria.find((candidate) => candidate.id === criterionId);
	return criterion ?? ultragoalFail(`Success criterion not found: ${criterionId}.`, "ULTRAGOAL_CRITERION_NOT_FOUND", { goalId: goal.id, criterionId });
}

function nonEmptyEvidence(evidence: string): string { const trimmed = evidence.trim(); return trimmed || ultragoalFail("Evidence must be a non-empty string.", "ULTRAGOAL_EVIDENCE_REQUIRED", {}); }

export async function recordEvidence(repoRoot: string, args: RecordEvidenceArgs): Promise<{ plan: UltragoalPlan; goal: UltragoalItem; criterion: UltragoalSuccessCriterion; ledgerEntry: UltragoalLedgerEntry }> {
	return withUltragoalMutationLock(repoRoot, async () => {
		const plan = await readUltragoalPlan(repoRoot);
		const goal = findGoal(plan, args.goalId);
		const criterion = findCriterion(goal, args.criterionId);
		const evidence = nonEmptyEvidence(args.evidence);
		const kind = ledgerKind(args.status);
		const prevStatus = criterion.status;
		const capturedAt = iso();
		criterion.status = args.status;
		criterion.capturedEvidence = evidence;
		criterion.capturedAt = capturedAt;
		if (args.notes !== undefined) criterion.notes = args.notes;
		goal.updatedAt = capturedAt;
		plan.updatedAt = capturedAt;
		await writePlan(repoRoot, plan);
		const ledgerEntry: UltragoalLedgerEntry = {
			at: capturedAt,
			kind,
			goalId: goal.id,
			criterionId: criterion.id,
			criterionStatus: args.status,
			evidence,
			capturedEvidence: evidence,
			before: { status: prevStatus },
			after: { goalId: goal.id, criterionId: criterion.id, status: args.status, evidence, capturedAt, prevStatus },
		};
		await appendLedger(repoRoot, ledgerEntry);
		return { plan, goal, criterion, ledgerEntry };
	});
}

export async function markCriteriaPendingResetForGoal(repoRoot: string, goalId: string): Promise<{ plan: UltragoalPlan; resetCount: number }> {
	return withUltragoalMutationLock(repoRoot, async () => {
		const plan = await readUltragoalPlan(repoRoot);
		const goal = findGoal(plan, goalId);
		const now = iso();
		const before = goal.successCriteria.map((criterion) => ({ id: criterion.id, status: criterion.status, capturedEvidence: criterion.capturedEvidence, capturedAt: criterion.capturedAt ?? null }));
		for (const criterion of goal.successCriteria) {
			criterion.status = "pending";
			criterion.capturedEvidence = null;
			delete criterion.capturedAt;
			delete criterion.notes;
		}
		goal.updatedAt = now;
		plan.updatedAt = now;
		await writePlan(repoRoot, plan);
		await appendLedger(repoRoot, { at: now, kind: "criteria_revised", goalId, message: `Reset ${goal.successCriteria.length} criteria to pending.`, before, after: { resetCount: goal.successCriteria.length } });
		return { plan, resetCount: goal.successCriteria.length };
	});
}

export function criteriaSummary(plan: UltragoalPlan): { totalCriteria: number; passCount: number; pendingCount: number; failCount: number; blockedCount: number; goalsWithUnresolvedCriteria: string[] } {
	let totalCriteria = 0;
	let passCount = 0;
	let pendingCount = 0;
	let failCount = 0;
	let blockedCount = 0;
	const goalsWithUnresolvedCriteria: string[] = [];
	for (const goal of plan.goals) {
		let unresolved = false;
		for (const criterion of goal.successCriteria) {
			totalCriteria += 1;
			if (criterion.status !== "pass") unresolved = true;
			switch (criterion.status) {
				case "pass": passCount += 1; break;
				case "pending": pendingCount += 1; break;
				case "fail": failCount += 1; break;
				case "blocked": blockedCount += 1; break;
				default: ultragoalFail("Invalid criterion status.", "ULTRAGOAL_CRITERION_STATUS_INVALID", { status: criterion.status });
			}
		}
		if (unresolved) goalsWithUnresolvedCriteria.push(goal.id);
	}
	return { totalCriteria, passCount, pendingCount, failCount, blockedCount, goalsWithUnresolvedCriteria };
}

export function unresolvedCriteriaOf(goal: UltragoalItem): UltragoalSuccessCriterion[] { return goal.successCriteria.filter((criterion) => criterion.status !== "pass"); }

export function requireAllCriteriaPass(goal: UltragoalItem): void {
	if (hasAllCriteriaPass(goal)) return;
	throw new UltragoalError(`Goal ${goal.id} has unresolved success criteria.`, "ultragoal_criteria_not_all_pass", {
		details: { goalId: goal.id, unresolved: unresolvedCriteriaOf(goal).map((criterion) => ({ id: criterion.id, status: criterion.status })) },
	});
}
