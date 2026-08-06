import { dirname, relative, resolve } from "node:path";

import { normalizeTextEdits } from "./workspace-edit-text.js";
import type {
	ParsedWorkspaceOperation,
	ParseFailure,
	SimulatedWorkspaceEdit,
} from "./workspace-edit-plan-types.js";
import type { PlannedWorkspaceOperation, WorkspaceSnapshotEntry } from "./workspace-edit-types.js";
import { WorkspaceEditValidationError } from "./workspace-edit-types.js";

function isSameOrDescendant(candidate: string, parent: string): boolean {
	const relativePath = relative(parent, candidate);
	return relativePath === "" || (!relativePath.startsWith("..") && relativePath !== "..");
}

function removeVirtualSubtree(virtual: Map<string, WorkspaceSnapshotEntry>, path: string): void {
	for (const candidate of [...virtual.keys()]) {
		if (isSameOrDescendant(candidate, path)) virtual.delete(candidate);
	}
	virtual.set(path, { kind: "missing" });
}

function moveVirtualSubtree(virtual: Map<string, WorkspaceSnapshotEntry>, oldPath: string, newPath: string): void {
	const moved = [...virtual.entries()].filter(([candidate]) => isSameOrDescendant(candidate, oldPath));
	removeVirtualSubtree(virtual, oldPath);
	removeVirtualSubtree(virtual, newPath);
	for (const [candidate, entry] of moved) {
		const suffix = relative(oldPath, candidate);
		virtual.set(suffix === "" ? newPath : resolve(newPath, suffix), entry);
	}
}

function virtualDirectoryHasChildren(virtual: ReadonlyMap<string, WorkspaceSnapshotEntry>, path: string): boolean {
	for (const [candidate, entry] of virtual) {
		if (candidate !== path && entry.kind !== "missing" && isSameOrDescendant(candidate, path)) return true;
	}
	return false;
}

function requireVirtualParent(
	virtual: ReadonlyMap<string, WorkspaceSnapshotEntry>,
	path: string,
	changeIndex: number,
): void {
	if (virtual.get(dirname(path))?.kind !== "directory") {
		throw new WorkspaceEditValidationError(changeIndex, `parent directory does not exist for ${path}`);
	}
}

export function simulateOperations(
	parsed: readonly ParsedWorkspaceOperation[],
	snapshots: ReadonlyMap<string, WorkspaceSnapshotEntry>,
): SimulatedWorkspaceEdit {
	const virtual = new Map(snapshots);
	const planned: PlannedWorkspaceOperation[] = [];
	const failures: ParseFailure[] = [];
	for (const operation of parsed) {
		try {
			planned.push(simulateOperation(operation, virtual));
		} catch (error) {
			if (error instanceof WorkspaceEditValidationError) {
				failures.push({ changeIndex: operation.changeIndex, message: error.detail });
				continue;
			}
			throw error;
		}
	}
	return { operations: planned, failures };
}

function simulateOperation(
	operation: ParsedWorkspaceOperation,
	virtual: Map<string, WorkspaceSnapshotEntry>,
): PlannedWorkspaceOperation {
	switch (operation.kind) {
		case "text":
			return simulateText(operation, virtual);
		case "create":
			return simulateCreate(operation, virtual);
		case "rename":
			return simulateRename(operation, virtual);
		case "delete":
			return simulateDelete(operation, virtual);
	}
}

function rejectSymbolicLink(operation: Exclude<ParsedWorkspaceOperation, { readonly kind: "text" }>): void {
	if (operation.followedSymbolicLink) {
		throw new WorkspaceEditValidationError(operation.changeIndex, "resource operations through symbolic links are unsupported");
	}
}

function simulateText(
	operation: Extract<ParsedWorkspaceOperation, { readonly kind: "text" }>,
	virtual: Map<string, WorkspaceSnapshotEntry>,
): PlannedWorkspaceOperation {
	const entry = virtual.get(operation.path);
	if (entry?.kind !== "file") throw new WorkspaceEditValidationError(operation.changeIndex, `${operation.path} is not a file`);
	const normalized = normalizeTextEdits(entry.content, operation.edits, operation.changeIndex);
	virtual.set(operation.path, { kind: "file", content: normalized.text });
	return {
		kind: "text",
		changeIndex: operation.changeIndex,
		path: operation.path,
		beforeText: entry.content,
		afterText: normalized.text,
		editCount: normalized.edits.length,
		documentVersion: operation.version,
	};
}

function simulateCreate(
	operation: Extract<ParsedWorkspaceOperation, { readonly kind: "create" }>,
	virtual: Map<string, WorkspaceSnapshotEntry>,
): PlannedWorkspaceOperation {
	rejectSymbolicLink(operation);
	requireVirtualParent(virtual, operation.path, operation.changeIndex);
	const target = virtual.get(operation.path) ?? { kind: "missing" };
	if (target.kind !== "missing") {
		if (operation.overwrite && target.kind === "file") {
			virtual.set(operation.path, { kind: "file", content: "" });
			return { kind: "create", changeIndex: operation.changeIndex, path: operation.path, replaced: true };
		}
		if (operation.ignoreIfExists) return { kind: "noop", changeIndex: operation.changeIndex };
		throw new WorkspaceEditValidationError(operation.changeIndex, `create target already exists: ${operation.path}`);
	}
	virtual.set(operation.path, { kind: "file", content: "" });
	return { kind: "create", changeIndex: operation.changeIndex, path: operation.path, replaced: false };
}

function simulateRename(
	operation: Extract<ParsedWorkspaceOperation, { readonly kind: "rename" }>,
	virtual: Map<string, WorkspaceSnapshotEntry>,
): PlannedWorkspaceOperation {
	rejectSymbolicLink(operation);
	const source = virtual.get(operation.oldPath) ?? { kind: "missing" };
	if (source.kind === "missing") {
		throw new WorkspaceEditValidationError(operation.changeIndex, `rename source does not exist: ${operation.oldPath}`);
	}
	if (operation.oldPath === operation.newPath) return { kind: "noop", changeIndex: operation.changeIndex };
	if (isSameOrDescendant(operation.newPath, operation.oldPath)) {
		throw new WorkspaceEditValidationError(operation.changeIndex, "cannot rename a path into its own subtree");
	}
	requireVirtualParent(virtual, operation.newPath, operation.changeIndex);
	const destination = virtual.get(operation.newPath) ?? { kind: "missing" };
	if (destination.kind !== "missing" && !operation.overwrite) {
		if (operation.ignoreIfExists) return { kind: "noop", changeIndex: operation.changeIndex };
		throw new WorkspaceEditValidationError(operation.changeIndex, `rename target already exists: ${operation.newPath}`);
	}
	moveVirtualSubtree(virtual, operation.oldPath, operation.newPath);
	return {
		kind: "rename",
		changeIndex: operation.changeIndex,
		oldPath: operation.oldPath,
		newPath: operation.newPath,
		sourceKind: source.kind,
		replaceDestination: destination.kind !== "missing",
	};
}

function simulateDelete(
	operation: Extract<ParsedWorkspaceOperation, { readonly kind: "delete" }>,
	virtual: Map<string, WorkspaceSnapshotEntry>,
): PlannedWorkspaceOperation {
	rejectSymbolicLink(operation);
	const target = virtual.get(operation.path) ?? { kind: "missing" };
	if (target.kind === "missing") {
		if (operation.ignoreIfNotExists) return { kind: "noop", changeIndex: operation.changeIndex };
		throw new WorkspaceEditValidationError(operation.changeIndex, `delete target does not exist: ${operation.path}`);
	}
	if (target.kind === "directory" && !operation.recursive && virtualDirectoryHasChildren(virtual, operation.path)) {
		throw new WorkspaceEditValidationError(operation.changeIndex, `directory is not empty: ${operation.path}`);
	}
	removeVirtualSubtree(virtual, operation.path);
	return {
		kind: "delete",
		changeIndex: operation.changeIndex,
		path: operation.path,
		targetKind: target.kind,
		recursive: operation.recursive,
	};
}
