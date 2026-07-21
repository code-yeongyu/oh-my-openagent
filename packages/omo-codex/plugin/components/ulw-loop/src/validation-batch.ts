// biome-ignore-all format: compact validation-batch helpers stay below the pure LOC budget.
import { readJsonInput } from "./cli-arg-parser.js";
import { isMemberResolved } from "./goal-status.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopQualityGate, UlwLoopValidationBatch } from "./types.js";
import { UlwLoopError } from "./types.js";

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(value: object, key: string): unknown {
	return Object.entries(value).find(([name]) => name === key)?.[1];
}

function text(value: object, key: string): string | undefined {
	const candidate = read(value, key);
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
}

function strings(value: object, key: string): readonly string[] | undefined {
	const candidate = read(value, key);
	return Array.isArray(candidate) && candidate.every((item) => typeof item === "string" && item.trim().length > 0)
		? candidate.map((item) => item.trim())
		: undefined;
}

export async function parseValidationBatches(
	input: string | undefined,
	goals: readonly UlwLoopItem[],
): Promise<readonly UlwLoopValidationBatch[] | undefined> {
	const raw = await readJsonInput(input);
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw)) fail("--validation-batch-json must be a JSON array.");
	const batches = raw.map(batchFromObject);
	validateBatches(batches, goals);
	return batches;
}

function batchFromObject(value: unknown): UlwLoopValidationBatch {
	if (!isObject(value)) fail("validation batch entries must be objects.");
	const batchId = text(value, "batchId");
	const memberIds = strings(value, "memberIds");
	const finalGoalId = text(value, "finalGoalId");
	if (batchId === undefined) fail("validation batch requires batchId.");
	if (memberIds === undefined || memberIds.length < 2) fail("validation batch requires at least two memberIds.");
	if (finalGoalId === undefined) fail("validation batch requires finalGoalId.");
	return { batchId, memberIds, finalGoalId };
}

function validateBatches(batches: readonly UlwLoopValidationBatch[], goals: readonly UlwLoopItem[]): void {
	const goalIds = new Set(goals.map((goal) => goal.id));
	const batchIds = new Set<string>();
	const members = new Set<string>();
	for (const batch of batches) {
		if (batchIds.has(batch.batchId)) fail(`duplicate validation batch id: ${batch.batchId}.`);
		batchIds.add(batch.batchId);
		if (!batch.memberIds.includes(batch.finalGoalId)) fail(`validation batch ${batch.batchId} finalGoalId must be a member.`);
		for (const memberId of batch.memberIds) {
			if (!goalIds.has(memberId)) fail(`validation batch ${batch.batchId} references unknown goal: ${memberId}.`);
			if (members.has(memberId)) fail(`goal appears in multiple validation batches: ${memberId}.`);
			members.add(memberId);
		}
	}
}

export function updateBatchesAfterSupersede(plan: UlwLoopPlan, targetId: string, replacementIds: readonly string[]): void {
	if (replacementIds.length === 0 || plan.validationBatches === undefined) return;
	plan.validationBatches = plan.validationBatches.map((batch) => {
		if (!batch.memberIds.includes(targetId)) return batch;
		const memberIds = batch.memberIds.flatMap((id) => (id === targetId ? [...replacementIds] : [id]));
		const replacementFinalGoalId = replacementIds[replacementIds.length - 1] ?? batch.finalGoalId;
		const finalGoalId = batch.finalGoalId === targetId ? replacementFinalGoalId : batch.finalGoalId;
		return { batchId: batch.batchId, memberIds, finalGoalId };
	});
}

export function batchUpdateLedgerEntry(before: UlwLoopPlan, after: UlwLoopPlan, at: string): UlwLoopLedgerEntry | null {
	if (JSON.stringify(before.validationBatches ?? []) === JSON.stringify(after.validationBatches ?? [])) return null;
	return { at, kind: "batch_updated", before: before.validationBatches ?? [], after: after.validationBatches ?? [], message: "Validation batch membership updated after steering." };
}

export function batchOf(plan: UlwLoopPlan, goalId: string): UlwLoopValidationBatch | undefined {
	return plan.validationBatches?.find((batch) => batch.memberIds.includes(goalId));
}

export function batchClosedBy(plan: UlwLoopPlan, goalId: string): UlwLoopValidationBatch | undefined {
	const batch = batchOf(plan, goalId);
	return batch?.finalGoalId === goalId ? batch : undefined;
}

export function requireBatchFinalReady(plan: UlwLoopPlan, goal: UlwLoopItem): void {
	const batch = batchClosedBy(plan, goal.id);
	if (batch === undefined) return;
	const open = batch.memberIds.filter((id) => id !== goal.id && !memberResolved(plan, id));
	if (open.length > 0) throw new UlwLoopError("Validation batch has unresolved members.", "ULW_LOOP_VALIDATION_BATCH_OPEN", { details: { batchId: batch.batchId, open } });
}

export function requireAllValidationBatchesClosed(plan: UlwLoopPlan, closingGoalId?: string): void {
	const open = (plan.validationBatches ?? []).filter((batch) => batch.memberIds.some((id) => id !== closingGoalId && !memberResolved(plan, id)));
	if (open.length > 0) throw new UlwLoopError("Validation batches remain open.", "ULW_LOOP_VALIDATION_BATCH_OPEN", { details: { batchIds: open.map((batch) => batch.batchId) } });
}

export function requireBatchGate(plan: UlwLoopPlan, goal: UlwLoopItem, gate: UlwLoopQualityGate): void {
	const batch = batchClosedBy(plan, goal.id);
	if (batch === undefined) return;
	const members = batch.memberIds.map((id) => plan.goals.find((item) => item.id === id)).filter((item): item is UlwLoopItem => item !== undefined);
	const pending = members.flatMap((member) => member.successCriteria.filter((criterion) => criterion.status !== "pass").map((criterion) => `${member.id}:${criterion.id}`));
	if (pending.length > 0) throw new UlwLoopError("Validation batch criteria remain pending.", "ULW_LOOP_VALIDATION_BATCH_CRITERIA_PENDING", { details: { batchId: batch.batchId, pending } });
	const totalCriteria = members.reduce((sum, member) => sum + member.successCriteria.length, 0);
	const passCount = members.reduce((sum, member) => sum + member.successCriteria.filter((criterion) => criterion.status === "pass").length, 0);
	if (gate.criteriaCoverage.totalCriteria !== totalCriteria || gate.criteriaCoverage.passCount !== passCount) throw new UlwLoopError("Validation batch gate coverage does not match member criteria.", "ULW_LOOP_VALIDATION_BATCH_GATE_MISMATCH", { details: { batchId: batch.batchId, expected: { totalCriteria, passCount }, actual: gate.criteriaCoverage } });
}

function memberResolved(plan: UlwLoopPlan, goalId: string): boolean {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	return goal !== undefined && isMemberResolved(goal, plan);
}

function fail(message: string): never {
	throw new UlwLoopError(message, "ULW_LOOP_VALIDATION_BATCH_INVALID");
}
