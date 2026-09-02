/**
 * Compact before/after snapshots for steering ledger entries.
 *
 * Ledger entries used to embed the FULL plan (every goal, criterion, and
 * evidence string) twice per audit and twice more at the entry top level.
 * That made each accepted steer O(plan size) on disk, so the ledger grew
 * quadratically over a run, and every dedup scan re-hydrated all of it into
 * memory. A snapshot instead records plan-level counters plus only the goals
 * the mutation actually touched, keeping each entry O(changed goals).
 */
export function buildSteeringPlanSnapshot(plan, changedGoalIds) {
    const snapshot = {
        updatedAt: plan.updatedAt,
        goalCount: plan.goals.length,
        goalIds: plan.goals.map((goal) => goal.id),
        goals: plan.goals.filter((goal) => changedGoalIds.has(goal.id)),
    };
    return plan.activeGoalId === undefined ? snapshot : { ...snapshot, activeGoalId: plan.activeGoalId };
}
/** Ids of goals that differ between two plans, including added or removed goals. */
export function changedGoalIdsBetween(before, after) {
    const beforeById = new Map(before.goals.map((goal) => [goal.id, goal]));
    const changed = new Set();
    for (const goal of after.goals) {
        const prior = beforeById.get(goal.id);
        if (prior === undefined || JSON.stringify(prior) !== JSON.stringify(goal))
            changed.add(goal.id);
        beforeById.delete(goal.id);
    }
    for (const id of beforeById.keys())
        changed.add(id);
    return changed;
}
