import { canonicalFingerprint } from "./workspace-edit-fingerprint.js";
import { canonicalWorkspaceRoot } from "./workspace-edit-path.js";
import { failureResult, parseWorkspaceEdit } from "./workspace-edit-parser.js";
import type { ParsedWorkspaceOperation, WorkspaceEditFingerprintResult } from "./workspace-edit-plan-types.js";
import { simulateOperations } from "./workspace-edit-simulation.js";
import { snapshotOperations } from "./workspace-edit-snapshot.js";
import type { WorkspaceEditPlan, WorkspaceEditPlanResult } from "./workspace-edit-types.js";

export type { WorkspaceEditFingerprintResult } from "./workspace-edit-plan-types.js";

class PlanPathIndex {
	readonly firstChangeByPath = new Map<string, number>();
	readonly reportedPathByCanonical = new Map<string, string>();

	build(operations: readonly ParsedWorkspaceOperation[]): void {
		for (const operation of operations) {
			switch (operation.kind) {
				case "rename":
					this.add(operation.oldPath, operation.reportedOldPath, operation.changeIndex);
					this.add(operation.newPath, operation.reportedNewPath, operation.changeIndex);
					break;
				case "text":
				case "create":
				case "delete":
					this.add(operation.path, operation.reportedPath, operation.changeIndex);
					break;
			}
		}
	}

	private add(path: string, reportedPath: string, changeIndex: number): void {
		if (!this.firstChangeByPath.has(path)) this.firstChangeByPath.set(path, changeIndex);
		if (!this.reportedPathByCanonical.has(path)) this.reportedPathByCanonical.set(path, reportedPath);
	}
}

export function fingerprintWorkspaceEdit(edit: unknown, workspaceRoot: string): WorkspaceEditFingerprintResult {
	const root = canonicalWorkspaceRoot(workspaceRoot);
	if (!root.success) return { success: false, result: failureResult([{ changeIndex: 0, message: root.error }]) };
	const parsed = parseWorkspaceEdit(edit, root.path);
	if (parsed.failures.length > 0) return { success: false, result: failureResult(parsed.failures) };
	return { success: true, fingerprint: canonicalFingerprint(parsed.operations) };
}

export function planWorkspaceEdit(edit: unknown, workspaceRoot: string): WorkspaceEditPlanResult {
	const root = canonicalWorkspaceRoot(workspaceRoot);
	if (!root.success) return { success: false, result: failureResult([{ changeIndex: 0, message: root.error }]) };
	const parsed = parseWorkspaceEdit(edit, root.path);
	if (parsed.failures.length > 0) return { success: false, result: failureResult(parsed.failures) };

	let snapshots;
	try {
		snapshots = snapshotOperations(parsed.operations, root.path);
	} catch (error) {
		return {
			success: false,
			result: failureResult([{ changeIndex: 0, message: error instanceof Error ? error.message : String(error) }]),
		};
	}
	const simulated = simulateOperations(parsed.operations, snapshots);
	if (simulated.failures.length > 0) return { success: false, result: failureResult(simulated.failures) };
	const paths = new PlanPathIndex();
	paths.build(parsed.operations);
	const plan: WorkspaceEditPlan = {
		workspaceRoot: root.path,
		operations: simulated.operations,
		snapshots,
		firstChangeByPath: paths.firstChangeByPath,
		reportedPathByCanonical: paths.reportedPathByCanonical,
		fingerprint: canonicalFingerprint(parsed.operations),
	};
	return { success: true, plan };
}
