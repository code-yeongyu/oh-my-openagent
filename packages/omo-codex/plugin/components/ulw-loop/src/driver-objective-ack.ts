import type { UlwLoopPlan } from "./types.js";

export function normalizeDriverObjective(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function acknowledgedDriverObjectives(plan: UlwLoopPlan): readonly string[] {
	return plan.acknowledgedDriverObjectives ?? [];
}

// A differing driver objective is reported once; the plan remembers the exact text so every later
// checkpoint under the same driver stays quiet, while a driver rewritten to a third objective is
// reported again.
export function acknowledgeDriverObjective(plan: UlwLoopPlan, objective: string | undefined): boolean {
	if (objective === undefined) return false;
	const normalized = normalizeDriverObjective(objective);
	if (!normalized || acknowledgedDriverObjectives(plan).includes(normalized)) return false;
	plan.acknowledgedDriverObjectives = [...acknowledgedDriverObjectives(plan), normalized];
	return true;
}
