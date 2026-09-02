import { essentialCriteriaOf, hasAllCriteriaPass, hasEssentialCriteriaPass } from "./goal-status.js";
import { appendLedger, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import { iso, UlwLoopError } from "./types.js";
function ulwLoopFail(message, code, details) {
    throw new UlwLoopError(message, code, { details });
}
function ledgerKind(status) {
    switch (status) {
        case "pass":
            return "evidence_captured";
        case "fail":
            return "criterion_failed";
        case "blocked":
            return "criterion_blocked";
        default:
            return ulwLoopFail("Invalid criterion status.", "ULW_LOOP_CRITERION_STATUS_INVALID", { status });
    }
}
function findGoal(plan, goalId) {
    const goal = plan.goals.find((candidate) => candidate.id === goalId);
    return goal ?? ulwLoopFail(`UlwLoop goal not found: ${goalId}.`, "ULW_LOOP_GOAL_NOT_FOUND", { goalId });
}
function findCriterion(goal, criterionId) {
    const criterion = goal.successCriteria.find((candidate) => candidate.id === criterionId);
    return (criterion ??
        ulwLoopFail(`Success criterion not found: ${criterionId}.`, "ULW_LOOP_CRITERION_NOT_FOUND", {
            goalId: goal.id,
            criterionId,
        }));
}
function nonEmptyEvidence(evidence) {
    const trimmed = evidence.trim();
    return trimmed || ulwLoopFail("Evidence must be a non-empty string.", "ULW_LOOP_EVIDENCE_REQUIRED", {});
}
export async function recordEvidence(repoRoot, args, scope) {
    return withUlwLoopMutationLock(repoRoot, scope, async () => {
        const plan = await readUlwLoopPlan(repoRoot, scope);
        const goal = findGoal(plan, args.goalId);
        const criterion = findCriterion(goal, args.criterionId);
        const evidence = nonEmptyEvidence(args.evidence);
        const kind = ledgerKind(args.status);
        const prevStatus = criterion.status;
        const capturedAt = iso();
        criterion.status = args.status;
        criterion.capturedEvidence = evidence;
        criterion.capturedAt = capturedAt;
        if (args.notes !== undefined)
            criterion.notes = args.notes;
        goal.updatedAt = capturedAt;
        plan.updatedAt = capturedAt;
        await writePlan(repoRoot, plan, scope);
        const ledgerEntry = {
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
        await appendLedger(repoRoot, ledgerEntry, scope);
        return { plan, goal, criterion, ledgerEntry };
    });
}
export async function markCriteriaPendingResetForGoal(repoRoot, goalId, scope) {
    return withUlwLoopMutationLock(repoRoot, scope, async () => {
        const plan = await readUlwLoopPlan(repoRoot, scope);
        const goal = findGoal(plan, goalId);
        const now = iso();
        const before = goal.successCriteria.map((criterion) => ({
            id: criterion.id,
            status: criterion.status,
            capturedEvidence: criterion.capturedEvidence,
            capturedAt: criterion.capturedAt ?? null,
        }));
        for (const criterion of goal.successCriteria) {
            criterion.status = "pending";
            criterion.capturedEvidence = null;
            delete criterion.capturedAt;
            delete criterion.notes;
        }
        goal.updatedAt = now;
        plan.updatedAt = now;
        await writePlan(repoRoot, plan, scope);
        await appendLedger(repoRoot, {
            at: now,
            kind: "criteria_revised",
            goalId,
            message: `Reset ${goal.successCriteria.length} criteria to pending.`,
            before,
            after: { resetCount: goal.successCriteria.length },
        }, scope);
        return { plan, resetCount: goal.successCriteria.length };
    });
}
export function criteriaSummary(plan) {
    let totalCriteria = 0;
    let passCount = 0;
    let pendingCount = 0;
    let failCount = 0;
    let blockedCount = 0;
    const goalsWithUnresolvedCriteria = [];
    for (const goal of plan.goals) {
        let unresolved = false;
        for (const criterion of goal.successCriteria) {
            totalCriteria += 1;
            if (criterion.status !== "pass")
                unresolved = true;
            switch (criterion.status) {
                case "pass":
                    passCount += 1;
                    break;
                case "pending":
                    pendingCount += 1;
                    break;
                case "fail":
                    failCount += 1;
                    break;
                case "blocked":
                    blockedCount += 1;
                    break;
                default:
                    ulwLoopFail("Invalid criterion status.", "ULW_LOOP_CRITERION_STATUS_INVALID", {
                        status: criterion.status,
                    });
            }
        }
        if (unresolved)
            goalsWithUnresolvedCriteria.push(goal.id);
    }
    return { totalCriteria, passCount, pendingCount, failCount, blockedCount, goalsWithUnresolvedCriteria };
}
export function unresolvedCriteriaOf(goal) {
    return goal.successCriteria.filter((criterion) => criterion.status !== "pass");
}
export function unresolvedEssentialCriteriaOf(goal) {
    const essentialCriteria = new Set(essentialCriteriaOf(goal).map((criterion) => criterion.id));
    return goal.successCriteria.filter((criterion) => essentialCriteria.has(criterion.id) && criterion.status !== "pass");
}
export function requireAllCriteriaPass(goal) {
    if (hasAllCriteriaPass(goal))
        return;
    throw new UlwLoopError(`Goal ${goal.id} has unresolved success criteria.`, "ulw_loop_criteria_not_all_pass", {
        details: {
            goalId: goal.id,
            unresolved: unresolvedCriteriaOf(goal).map((criterion) => ({ id: criterion.id, status: criterion.status })),
        },
    });
}
export function requireAllPlanCriteriaPass(plan) {
    const unresolved = plan.goals.flatMap((goal) => unresolvedCriteriaOf(goal).map((criterion) => ({
        goalId: goal.id,
        id: criterion.id,
        status: criterion.status,
    })));
    if (unresolved.length === 0)
        return;
    throw new UlwLoopError("Ulw-loop aggregate has unresolved success criteria.", "ulw_loop_criteria_not_all_pass", {
        details: { unresolved },
    });
}
export function requireEssentialCriteriaPass(goal) {
    if (hasEssentialCriteriaPass(goal))
        return;
    throw new UlwLoopError(`Goal ${goal.id} has unresolved essential success criteria.`, "ulw_loop_criteria_not_all_pass", {
        details: {
            goalId: goal.id,
            unresolved: unresolvedEssentialCriteriaOf(goal).map((criterion) => ({
                id: criterion.id,
                status: criterion.status,
            })),
        },
    });
}
