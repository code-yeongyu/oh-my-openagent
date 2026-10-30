import type { UlwLoopSuccessCriterion, UlwLoopSuccessCriterionUserModel } from "./types.js";
import { ULW_LOOP_SUCCESS_CRITERION_USER_MODELS, UlwLoopError } from "./types.js";

export interface SuccessCriterionInput {
	readonly scenario: string;
	readonly expectedEvidence: string;
	readonly userModel?: UlwLoopSuccessCriterionUserModel;
	readonly essential?: boolean;
}

function invalid(message: string, details: Record<string, unknown>): never {
	throw new UlwLoopError(`Invalid successCriteria: ${message}`, "ULW_LOOP_ARGUMENT_INVALID", { details });
}

function isUserModel(value: unknown): value is UlwLoopSuccessCriterionUserModel {
	return typeof value === "string" && ULW_LOOP_SUCCESS_CRITERION_USER_MODELS.some((model) => model === value);
}

function requireText(value: unknown, field: string, index: number): string {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed || invalid(`entry ${index + 1} needs a non-empty ${field}.`, { index, field });
}

export function criterionId(index: number): string {
	return `C${String(index + 1).padStart(3, "0")}`;
}

export function criteriaFromInput(input: readonly unknown[]): UlwLoopSuccessCriterion[] {
	if (input.length === 0) invalid("provide at least one criterion or omit the field for placeholders.", { count: 0 });
	return input.map((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry))
			return invalid(`entry ${index + 1} must be an object.`, { index });
		const record: Record<string, unknown> = { ...entry };
		const userModel = record["userModel"] ?? "happy";
		if (!isUserModel(userModel))
			return invalid(
				`entry ${index + 1} userModel must be one of ${ULW_LOOP_SUCCESS_CRITERION_USER_MODELS.join(", ")}.`,
				{
					index,
					userModel: String(userModel),
				},
			);
		const essential = record["essential"];
		if (essential !== undefined && typeof essential !== "boolean")
			return invalid(`entry ${index + 1} essential must be a boolean.`, { index });
		return {
			id: criterionId(index),
			scenario: requireText(record["scenario"], "scenario", index),
			userModel,
			expectedEvidence: requireText(record["expectedEvidence"], "expectedEvidence", index),
			essential: essential ?? true,
			capturedEvidence: null,
			status: "pending",
		};
	});
}
