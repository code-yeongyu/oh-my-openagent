import { ulwLoopGoalsRelativePath, ulwLoopLedgerRelativePath } from "./paths.js";
export const ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE = aggregateCodexObjectiveForScope();
export function aggregateCodexObjectiveForScope(scope) {
    return `Complete the durable ulw-loop plan in ${ulwLoopGoalsRelativePath(scope)}, including later accepted/appended stories, under the original brief constraints; use ${ulwLoopLedgerRelativePath(scope)} as the audit trail.`;
}
export function codexGoalMode(plan) {
    return plan.codexGoalMode ?? "per_story";
}
function isResolvedStatus(status) {
    return status === "complete";
}
export function isMemberResolved(goal, plan) {
    return isResolvedStatus(goal.status) || isSupersededResolved(goal, plan);
}
function isSupersededResolved(goal, plan) {
    if (goal.steeringStatus !== "superseded")
        return false;
    const replacements = goal.supersededBy ?? [];
    if (replacements.length === 0)
        return false;
    return replacements.every((id) => {
        const replacement = plan.goals.find((candidate) => candidate.id === id);
        return replacement !== undefined && isResolvedStatus(replacement.status);
    });
}
function isCompletionBlocking(goal, plan) {
    if (goal.steeringStatus === "superseded")
        return !isSupersededResolved(goal, plan);
    if (goal.steeringStatus === "blocked")
        return true;
    return !isResolvedStatus(goal.status);
}
function isCompletionBlockingForFinalCandidate(candidate, finalCandidate, plan) {
    if (candidate.id === finalCandidate.id)
        return false;
    if (candidate.steeringStatus === "superseded") {
        const replacements = candidate.supersededBy ?? [];
        if (replacements.length === 0)
            return true;
        return !replacements.every((id) => {
            if (id === finalCandidate.id)
                return true;
            const replacement = plan.goals.find((goal) => goal.id === id);
            return replacement !== undefined && isResolvedStatus(replacement.status);
        });
    }
    return isCompletionBlocking(candidate, plan);
}
export function isUlwLoopDone(plan) {
    if (plan.aggregateCompletion?.status === "complete")
        return true;
    return plan.goals.every((goal) => !isCompletionBlocking(goal, plan));
}
export function isFinalRunCompletionCandidate(plan, goal) {
    return (isCompletionBlocking(goal, plan) &&
        plan.goals.every((candidate) => !isCompletionBlockingForFinalCandidate(candidate, goal, plan)));
}
export function aggregateCodexObjective(plan) {
    return plan.codexObjective ?? ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE;
}
export function expectedCodexObjective(plan, goal) {
    return codexGoalMode(plan) === "aggregate" ? aggregateCodexObjective(plan) : goal.objective;
}
export function compatibleCodexObjectives(plan) {
    return [aggregateCodexObjective(plan), ...(plan.codexObjectiveAliases ?? [])];
}
export function hasAllCriteriaPass(goal) {
    return goal.successCriteria.length > 0 && goal.successCriteria.every((criterion) => criterion.status === "pass");
}
export function isEssentialCriterion(criterion) {
    return criterion.essential ?? true;
}
export function essentialCriteriaOf(goal) {
    const explicit = goal.successCriteria.filter(isEssentialCriterion);
    if (explicit.length > 0)
        return explicit;
    const happy = goal.successCriteria.find((criterion) => criterion.userModel === "happy");
    return happy === undefined ? [] : [happy];
}
export function hasEssentialCriteriaPass(goal) {
    const criteria = essentialCriteriaOf(goal);
    return criteria.length > 0 && criteria.every((criterion) => criterion.status === "pass");
}
export function firstUnresolvedCriterion(goal) {
    return goal.successCriteria.find((criterion) => criterion.status !== "pass");
}
