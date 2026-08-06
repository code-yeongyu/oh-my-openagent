import { uriToCanonicalWorkspacePath } from "./workspace-edit-path.js";
import { isRecord, parseTextEdits } from "./workspace-edit-parse-helpers.js";
import type { ParsedWorkspaceEdit, ParsedWorkspaceOperation, ParseFailure } from "./workspace-edit-plan-types.js";
import { parseResourceChange } from "./workspace-edit-resource-parser.js";
import type { ApplyResult } from "./workspace-edit-types.js";
import { WorkspaceEditValidationError } from "./workspace-edit-types.js";

interface ParseTarget {
	readonly operations: ParsedWorkspaceOperation[];
	readonly failures: ParseFailure[];
}

interface DocumentChangeInput {
	readonly change: unknown;
	readonly changeIndex: number;
	readonly workspaceRoot: string;
	readonly target: ParseTarget;
}

export function failureResult(failures: readonly ParseFailure[]): ApplyResult {
	const sorted = [...failures].sort((left, right) => left.changeIndex - right.changeIndex);
	const first = sorted[0];
	return {
		success: false,
		filesModified: [],
		totalEdits: 0,
		errors: sorted.map((failure) => `change ${failure.changeIndex}: ${failure.message}`),
		...(first ? { failedChange: first.changeIndex } : {}),
	};
}

export function parseWorkspaceEdit(edit: unknown, workspaceRoot: string): ParsedWorkspaceEdit {
	if (!isRecord(edit)) return { operations: [], failures: [{ changeIndex: 0, message: "No edit provided" }] };
	if (edit["changeAnnotations"] !== undefined) {
		return { operations: [], failures: [{ changeIndex: 0, message: "change annotations are unsupported" }] };
	}
	const hasChanges = edit["changes"] !== undefined;
	const hasDocumentChanges = edit["documentChanges"] !== undefined;
	if (hasChanges && hasDocumentChanges) {
		return {
			operations: [],
			failures: [{ changeIndex: 0, message: "changes and documentChanges cannot be combined" }],
		};
	}

	const target: ParseTarget = { operations: [], failures: [] };
	if (hasChanges) return parseChanges(edit["changes"], workspaceRoot, target);
	return parseDocumentChanges(edit["documentChanges"], workspaceRoot, target);
}

function parseChanges(value: unknown, workspaceRoot: string, target: ParseTarget): ParsedWorkspaceEdit {
	if (!isRecord(value)) return { ...target, failures: [{ changeIndex: 0, message: "changes must be an object" }] };
	const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
	for (const [changeIndex, [uri, rawEdits]] of entries.entries()) {
		const resolvedPath = uriToCanonicalWorkspacePath(uri, workspaceRoot);
		if (!resolvedPath.success) {
			target.failures.push({ changeIndex, message: resolvedPath.error });
			continue;
		}
		try {
			target.operations.push({
				kind: "text",
				changeIndex,
				path: resolvedPath.path,
				reportedPath: resolvedPath.requestedPath,
				edits: parseTextEdits(rawEdits, changeIndex),
				version: null,
			});
		} catch (error) {
			if (error instanceof WorkspaceEditValidationError) {
				target.failures.push({ changeIndex, message: error.detail });
				continue;
			}
			throw error;
		}
	}
	return target;
}

function parseDocumentChanges(value: unknown, workspaceRoot: string, target: ParseTarget): ParsedWorkspaceEdit {
	if (value === undefined) return target;
	if (!Array.isArray(value)) {
		return { ...target, failures: [{ changeIndex: 0, message: "documentChanges must be an array" }] };
	}
	for (const [changeIndex, change] of value.entries()) {
		try {
			parseDocumentChange({ change, changeIndex, workspaceRoot, target });
		} catch (error) {
			if (error instanceof WorkspaceEditValidationError) {
				target.failures.push({ changeIndex, message: error.detail });
				continue;
			}
			throw error;
		}
	}
	return target;
}

function parseDocumentChange(input: DocumentChangeInput): void {
	const { change, changeIndex, workspaceRoot, target } = input;
	if (!isRecord(change)) throw new WorkspaceEditValidationError(changeIndex, "document change must be an object");
	if ("annotationId" in change) {
		throw new WorkspaceEditValidationError(changeIndex, "annotated resource operations are unsupported");
	}
	if (typeof change["kind"] === "string") {
		parseResourceChange({ change, changeIndex, workspaceRoot, target });
		return;
	}
	const identifier = change["textDocument"];
	if (!isRecord(identifier) || typeof identifier["uri"] !== "string") {
		throw new WorkspaceEditValidationError(changeIndex, "textDocument.uri is required");
	}
	const version = identifier["version"];
	if (version !== null && (!Number.isInteger(version) || typeof version !== "number" || version < 0)) {
		throw new WorkspaceEditValidationError(changeIndex, "document version must be null or a non-negative integer");
	}
	const resolvedPath = uriToCanonicalWorkspacePath(identifier["uri"], workspaceRoot);
	if (!resolvedPath.success) {
		target.failures.push({ changeIndex, message: resolvedPath.error });
		return;
	}
	target.operations.push({
		kind: "text",
		changeIndex,
		path: resolvedPath.path,
		reportedPath: resolvedPath.requestedPath,
		edits: parseTextEdits(change["edits"], changeIndex),
		version,
	});
}
