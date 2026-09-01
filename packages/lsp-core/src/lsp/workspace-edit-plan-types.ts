import type { TextEdit } from "./types.js";
import type { ApplyResult, PlannedWorkspaceOperation } from "./workspace-edit-types.js";

export type ParsedWorkspaceOperation =
	| {
			readonly kind: "text";
			readonly changeIndex: number;
			readonly path: string;
			readonly reportedPath: string;
			readonly edits: readonly TextEdit[];
			readonly version: number | null;
	  }
	| {
			readonly kind: "create";
			readonly changeIndex: number;
			readonly path: string;
			readonly reportedPath: string;
			readonly overwrite: boolean;
			readonly ignoreIfExists: boolean;
			readonly followedSymbolicLink: boolean;
	  }
	| {
			readonly kind: "rename";
			readonly changeIndex: number;
			readonly oldPath: string;
			readonly newPath: string;
			readonly reportedOldPath: string;
			readonly reportedNewPath: string;
			readonly overwrite: boolean;
			readonly ignoreIfExists: boolean;
			readonly followedSymbolicLink: boolean;
	  }
	| {
			readonly kind: "delete";
			readonly changeIndex: number;
			readonly path: string;
			readonly reportedPath: string;
			readonly recursive: boolean;
			readonly ignoreIfNotExists: boolean;
			readonly followedSymbolicLink: boolean;
	  };

export interface ParseFailure {
	readonly changeIndex: number;
	readonly message: string;
}

export interface ParsedWorkspaceEdit {
	readonly operations: readonly ParsedWorkspaceOperation[];
	readonly failures: readonly ParseFailure[];
}

export interface SimulatedWorkspaceEdit {
	readonly operations: readonly PlannedWorkspaceOperation[];
	readonly failures: readonly ParseFailure[];
}

export type WorkspaceEditFingerprintResult =
	| { readonly success: true; readonly fingerprint: string }
	| { readonly success: false; readonly result: ApplyResult };
