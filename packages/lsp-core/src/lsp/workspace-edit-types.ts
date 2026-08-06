import type { TextEdit, WorkspaceEdit } from "./types.js";

export interface ApplyResult {
	readonly success: boolean;
	readonly filesModified: readonly string[];
	readonly totalEdits: number;
	readonly errors: readonly string[];
	readonly failedChange?: number;
	readonly lateAbort?: boolean;
}

export interface LspRenameResult {
	readonly edit: WorkspaceEdit | null;
	readonly apply: ApplyResult;
}

export type WorkspaceSnapshotEntry =
	| { readonly kind: "missing" }
	| { readonly kind: "file"; readonly content: string }
	| { readonly kind: "directory"; readonly children?: readonly string[] };

export type PlannedWorkspaceOperation =
	| {
			readonly kind: "text";
			readonly changeIndex: number;
			readonly path: string;
			readonly beforeText: string;
			readonly afterText: string;
			readonly editCount: number;
			readonly documentVersion: number | null;
	  }
	| {
			readonly kind: "create";
			readonly changeIndex: number;
			readonly path: string;
			readonly replaced: boolean;
	  }
	| {
			readonly kind: "rename";
			readonly changeIndex: number;
			readonly oldPath: string;
			readonly newPath: string;
			readonly sourceKind: "file" | "directory";
			readonly replaceDestination: boolean;
	  }
	| {
			readonly kind: "delete";
			readonly changeIndex: number;
			readonly path: string;
			readonly targetKind: "file" | "directory";
			readonly recursive: boolean;
	  }
	| { readonly kind: "noop"; readonly changeIndex: number };

export interface WorkspaceEditPlan {
	readonly workspaceRoot: string;
	readonly operations: readonly PlannedWorkspaceOperation[];
	readonly snapshots: ReadonlyMap<string, WorkspaceSnapshotEntry>;
	readonly firstChangeByPath: ReadonlyMap<string, number>;
	readonly reportedPathByCanonical: ReadonlyMap<string, string>;
	readonly fingerprint: string;
}

export type WorkspaceEditPlanResult =
	| { readonly success: true; readonly plan: WorkspaceEditPlan }
	| { readonly success: false; readonly result: ApplyResult };

export type WorkspaceMutation =
	| {
			readonly kind: "text";
			readonly path: string;
			readonly beforeText: string;
			readonly afterText: string;
	  }
	| { readonly kind: "create"; readonly path: string; readonly replaced: boolean }
	| {
			readonly kind: "rename";
			readonly oldPath: string;
			readonly newPath: string;
			readonly sourceKind: "file" | "directory";
	  }
	| { readonly kind: "delete"; readonly path: string; readonly targetKind: "file" | "directory" };

export interface WorkspaceMutationDelta {
	readonly operations: readonly WorkspaceMutation[];
	readonly changedPaths: readonly string[];
}

export interface WorkspaceEditCommit {
	readonly result: ApplyResult;
	readonly delta: WorkspaceMutationDelta;
	readonly fingerprint: string | null;
}

export interface WorkspaceEditCommitIo {
	readonly writeFile: (path: string, content: string) => void;
	readonly rename: (oldPath: string, newPath: string) => void;
	readonly remove: (path: string, recursive: boolean) => void;
}

export interface ApplyWorkspaceEditOptions {
	readonly workspaceRoot?: string;
	readonly signal?: AbortSignal;
	readonly io?: Partial<WorkspaceEditCommitIo>;
}

export interface NormalizedTextEditResult {
	readonly edits: readonly TextEdit[];
	readonly text: string;
}

export class WorkspaceEditValidationError extends Error {
	override readonly name = "WorkspaceEditValidationError";

	constructor(
		readonly changeIndex: number,
		readonly detail: string,
	) {
		super(`change ${changeIndex}: ${detail}`);
	}
}
