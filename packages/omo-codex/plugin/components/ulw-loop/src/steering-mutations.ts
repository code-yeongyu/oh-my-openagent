import { seedDefaultSuccessCriteria } from "./plan-crud.js";
import type { UlwLoopItem, UlwLoopPlan, UlwLoopSteeringChildGoal, UlwLoopSteeringProposal, UlwLoopSuccessCriterionUserModel } from "./types.js";
import { ULW_LOOP_SUCCESS_CRITERION_USER_MODELS } from "./types.js";
import { updateBatchesAfterSupersede } from "./validation-batch.js";

const read = (value: object, key: string): unknown => Object.entries(value).find(([name]) => name === key)?.[1];
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const text = (value: object, key: string): string | undefined => { const candidate = read(value, key); return isText(candidate) ? candidate.trim() : undefined; };
const isModel = (value: unknown): value is UlwLoopSuccessCriterionUserModel => typeof value === "string" && ULW_LOOP_SUCCESS_CRITERION_USER_MODELS.some((model) => model === value);
const after = (proposal: object): object | undefined => { const candidate = read(proposal, "after"); return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate) ? candidate : undefined; };
const revised = (proposal: object, direct: string, nested: string): string | undefined => text(proposal, direct) ?? text(after(proposal) ?? proposal, nested);
const targets = (proposal: UlwLoopSteeringProposal): string[] => proposal.targetGoalIds ?? [proposal.targetGoalId ?? text(proposal, "goalId") ?? ""].filter(Boolean);
const child = (value: unknown): UlwLoopSteeringChildGoal | null => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const title = text(value, "title"); const objective = text(value, "objective");
	return title === undefined || objective === undefined ? null : { title, objective };
};
const children = (proposal: UlwLoopSteeringProposal): UlwLoopSteeringChildGoal[] => {
	const direct = proposal.childGoals;
	if (direct !== undefined && direct.length > 0) return direct;
	const nested = after(proposal);
	const fromAfter = nested === undefined ? undefined : read(nested, "children");
	return Array.isArray(fromAfter) ? fromAfter.map(child).filter((item): item is UlwLoopSteeringChildGoal => item !== null) : [];
};
const goal = (plan: UlwLoopPlan, id: string | undefined): UlwLoopItem | undefined => id === undefined ? undefined : plan.goals.find((item) => item.id === id);

function nextId(plan: UlwLoopPlan, offset: number): string {
	const max = plan.goals.reduce((current, item) => { const digits = /^G(\d+)(?:-|$)/u.exec(item.id)?.[1]; return digits === undefined ? current : Math.max(current, Number(digits)); }, 0);
	return `G${String(max + offset).padStart(3, "0")}`;
}

export function makeGoal(plan: UlwLoopPlan, childGoal: UlwLoopSteeringChildGoal, evidence: string, now: string, offset: number): UlwLoopItem {
	const id = nextId(plan, offset); const digits = /^G(\d+)/u.exec(id)?.[1]; const goalIndex = digits === undefined ? plan.goals.length + offset - 1 : Number(digits) - 1;
	return { id, title: childGoal.title, objective: childGoal.objective, status: "pending", successCriteria: seedDefaultSuccessCriteria(goalIndex, childGoal.objective), attempt: 0, createdAt: now, updatedAt: now, evidence };
}

export function reviseWording(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]); if (target === undefined) return;
	target.title = revised(proposal, "revisedTitle", "title") ?? target.title; target.objective = revised(proposal, "revisedObjective", "objective") ?? target.objective;
	target.steeringEvidence = proposal.evidence; target.steeringRationale = proposal.rationale; target.updatedAt = now;
}

export function splitOrBlock(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]); if (target === undefined) return;
	const replacements = children(proposal).map((item, index) => makeGoal(plan, item, proposal.evidence, now, index + 1));
	target.steeringEvidence = proposal.evidence; target.steeringRationale = proposal.rationale; target.updatedAt = now;
	if (replacements.length === 0) { target.status = "blocked"; target.steeringStatus = "blocked"; target.blockedReason = proposal.blockedReason ?? proposal.rationale; }
	else { target.steeringStatus = "superseded"; target.supersededBy = replacements.map((item) => item.id); for (const item of replacements) item.supersedes = [target.id]; plan.goals.splice(plan.goals.indexOf(target) + 1, 0, ...replacements); updateBatchesAfterSupersede(plan, target.id, replacements.map((item) => item.id)); }
	if (plan.activeGoalId === target.id) delete plan.activeGoalId;
}

export function reviseCriterion(plan: UlwLoopPlan, proposal: UlwLoopSteeringProposal, now: string): void {
	const target = goal(plan, targets(proposal)[0]); const index = target?.successCriteria.findIndex((item) => item.id === proposal.criterionId) ?? -1; const current = target?.successCriteria[index];
	if (target === undefined || current === undefined) return;
	const model = read(proposal, "userModel");
	target.successCriteria[index] = { ...current, scenario: text(proposal, "scenario") ?? current.scenario, expectedEvidence: text(proposal, "expectedEvidence") ?? current.expectedEvidence, userModel: isModel(model) ? model : current.userModel };
	target.updatedAt = now;
}
