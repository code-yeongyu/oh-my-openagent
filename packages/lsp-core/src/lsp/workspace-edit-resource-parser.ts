import { uriToCanonicalWorkspacePath } from "./workspace-edit-path.js";
import { parseOptions } from "./workspace-edit-parse-helpers.js";
import type { ParsedWorkspaceOperation, ParseFailure } from "./workspace-edit-plan-types.js";
import { WorkspaceEditValidationError } from "./workspace-edit-types.js";

interface ResourceParseTarget {
	readonly operations: ParsedWorkspaceOperation[];
	readonly failures: ParseFailure[];
}

export interface ResourceChangeInput {
	readonly change: Record<string, unknown>;
	readonly changeIndex: number;
	readonly workspaceRoot: string;
	readonly target: ResourceParseTarget;
}

export function parseResourceChange(input: ResourceChangeInput): void {
	const kind = input.change["kind"];
	if (kind === "create" || kind === "delete") {
		parseSinglePathResource(input, kind);
		return;
	}
	if (kind !== "rename") {
		throw new WorkspaceEditValidationError(input.changeIndex, `unsupported resource operation ${String(kind)}`);
	}
	parseRename(input);
}

function parseSinglePathResource(input: ResourceChangeInput, kind: "create" | "delete"): void {
	const { change, changeIndex, workspaceRoot, target } = input;
	if (typeof change["uri"] !== "string") throw new WorkspaceEditValidationError(changeIndex, `${kind}.uri is required`);
	const resolvedPath = uriToCanonicalWorkspacePath(change["uri"], workspaceRoot);
	if (!resolvedPath.success) {
		target.failures.push({ changeIndex, message: resolvedPath.error });
		return;
	}
	if (kind === "create") {
		const options = parseOptions(change["options"], ["overwrite", "ignoreIfExists"], changeIndex);
		target.operations.push({
			kind,
			changeIndex,
			path: resolvedPath.path,
			reportedPath: resolvedPath.requestedPath,
			overwrite: options["overwrite"] ?? false,
			ignoreIfExists: options["ignoreIfExists"] ?? false,
			followedSymbolicLink: resolvedPath.followedSymbolicLink,
		});
		return;
	}
	const options = parseOptions(change["options"], ["recursive", "ignoreIfNotExists"], changeIndex);
	target.operations.push({
		kind,
		changeIndex,
		path: resolvedPath.path,
		reportedPath: resolvedPath.requestedPath,
		recursive: options["recursive"] ?? false,
		ignoreIfNotExists: options["ignoreIfNotExists"] ?? false,
		followedSymbolicLink: resolvedPath.followedSymbolicLink,
	});
}

function parseRename(input: ResourceChangeInput): void {
	const { change, changeIndex, workspaceRoot, target } = input;
	if (typeof change["oldUri"] !== "string" || typeof change["newUri"] !== "string") {
		throw new WorkspaceEditValidationError(changeIndex, "rename requires oldUri and newUri");
	}
	const oldPath = uriToCanonicalWorkspacePath(change["oldUri"], workspaceRoot);
	const newPath = uriToCanonicalWorkspacePath(change["newUri"], workspaceRoot);
	if (!oldPath.success || !newPath.success) {
		target.failures.push({
			changeIndex,
			message: !oldPath.success ? oldPath.error : !newPath.success ? newPath.error : "invalid rename path",
		});
		return;
	}
	const options = parseOptions(change["options"], ["overwrite", "ignoreIfExists"], changeIndex);
	target.operations.push({
		kind: "rename",
		changeIndex,
		oldPath: oldPath.path,
		newPath: newPath.path,
		reportedOldPath: oldPath.requestedPath,
		reportedNewPath: newPath.requestedPath,
		overwrite: options["overwrite"] ?? false,
		ignoreIfExists: options["ignoreIfExists"] ?? false,
		followedSymbolicLink: oldPath.followedSymbolicLink || newPath.followedSymbolicLink,
	});
}
