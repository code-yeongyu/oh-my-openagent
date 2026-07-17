import type { Position, Range, TextEdit } from "./types.js";
import { WorkspaceEditValidationError } from "./workspace-edit-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): Position | null {
	if (!isRecord(value) || typeof value["line"] !== "number" || typeof value["character"] !== "number") {
		return null;
	}
	return { line: value["line"], character: value["character"] };
}

function parseRange(value: unknown): Range | null {
	if (!isRecord(value)) return null;
	const start = parsePosition(value["start"]);
	const end = parsePosition(value["end"]);
	return start && end ? { start, end } : null;
}

export function parseTextEdits(value: unknown, changeIndex: number): readonly TextEdit[] {
	if (!Array.isArray(value)) {
		throw new WorkspaceEditValidationError(changeIndex, "text edits must be an array");
	}
	const edits: TextEdit[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate) || typeof candidate["newText"] !== "string") {
			throw new WorkspaceEditValidationError(changeIndex, "text edit requires range and newText");
		}
		if ("annotationId" in candidate) {
			throw new WorkspaceEditValidationError(changeIndex, "annotated text edits are unsupported");
		}
		const range = parseRange(candidate["range"]);
		if (!range) throw new WorkspaceEditValidationError(changeIndex, "text edit range is malformed");
		edits.push({ range, newText: candidate["newText"] });
	}
	return edits;
}

function parseBooleanOption(options: Record<string, unknown>, key: string, changeIndex: number): boolean {
	const value = options[key];
	if (value === undefined) return false;
	if (typeof value !== "boolean") {
		throw new WorkspaceEditValidationError(changeIndex, `${key} must be boolean`);
	}
	return value;
}

export function parseOptions(value: unknown, allowed: readonly string[], changeIndex: number): Record<string, boolean> {
	if (value === undefined) return {};
	if (!isRecord(value)) throw new WorkspaceEditValidationError(changeIndex, "resource options must be an object");
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new WorkspaceEditValidationError(changeIndex, `unsupported resource option ${key}`);
	}
	const parsed: Record<string, boolean> = {};
	for (const key of allowed) parsed[key] = parseBooleanOption(value, key, changeIndex);
	return parsed;
}
