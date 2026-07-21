import { readJsonInput } from "./cli-arg-parser.js";
import type { UlwLoopItem, UlwLoopValidationBatch } from "./types.js";
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

function fail(message: string): never {
	throw new UlwLoopError(message, "ULW_LOOP_VALIDATION_BATCH_INVALID");
}
