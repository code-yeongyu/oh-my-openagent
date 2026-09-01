import { existsSync, lstatSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { snapshotPath } from "./workspace-edit-path.js";
import type { ParsedWorkspaceOperation } from "./workspace-edit-plan-types.js";
import type { WorkspaceSnapshotEntry } from "./workspace-edit-types.js";

class WorkspaceSnapshotBuilder {
	private readonly snapshots = new Map<string, WorkspaceSnapshotEntry>();

	constructor(private readonly workspaceRoot: string) {}

	build(operations: readonly ParsedWorkspaceOperation[]): ReadonlyMap<string, WorkspaceSnapshotEntry> {
		this.add(this.workspaceRoot, false);
		for (const operation of operations) {
			switch (operation.kind) {
				case "rename":
					this.add(operation.oldPath, true);
					this.add(operation.newPath, true);
					break;
				case "delete":
					this.add(operation.path, true);
					break;
				case "text":
				case "create":
					this.add(operation.path, false);
					break;
			}
		}
		return this.snapshots;
	}

	private add(path: string, includeChildren: boolean): void {
		let candidate = path;
		while (true) {
			const existing = this.snapshots.get(candidate);
			if (existing === undefined || (includeChildren && existing.kind === "directory" && existing.children === undefined)) {
				this.snapshots.set(candidate, snapshotPath(candidate, includeChildren && candidate === path));
			}
			if (candidate === this.workspaceRoot) break;
			candidate = dirname(candidate);
		}
		if (!includeChildren || !existsSync(path) || !lstatSync(path).isDirectory()) return;
		for (const child of readdirSync(path)) this.add(resolve(path, child), true);
	}
}

export function snapshotOperations(
	operations: readonly ParsedWorkspaceOperation[],
	workspaceRoot: string,
): ReadonlyMap<string, WorkspaceSnapshotEntry> {
	return new WorkspaceSnapshotBuilder(workspaceRoot).build(operations);
}
