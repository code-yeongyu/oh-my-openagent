import type { ExtensionAPI, ToolDefinition } from "../../types.ts";
import type { APPLY_PATCH_PARAMS } from "./constants.ts";

export type ParsedPatch =
	| { type: "add"; filePath: string; content: string }
	| { type: "delete"; filePath: string }
	| { type: "update"; filePath: string; movePath?: string; chunks: PatchChunk[] };

export type PatchChunk = {
	changeContexts: string[];
	oldLines: string[];
	newLines: string[];
	isEndOfFile: boolean;
};

export type BaselineState = {
	nonGptToolNames: string[];
};

export type FreeformToolFormat = {
	type: "grammar";
	syntax: "lark";
	definition: string;
};

export type ApplyPatchParams = {
	input: string;
};

export type ApplyPatchOperation = "add" | "delete" | "update";

export type ApplyPatchPreviewFile = {
	filePath: string;
	movePath?: string;
	operation: ApplyPatchOperation;
	diff: string;
	added: number;
	removed: number;
};

export type ApplyPatchPreview = {
	files: ApplyPatchPreviewFile[];
	added: number;
	removed: number;
};

export type ApplyPatchToolDetails = {
	preview?: ApplyPatchPreview;
	progress?: ApplyPatchProgress;
	result?: ApplyPatchResult;
};

export type ApplyPatchProgress = {
	applied: number;
	failed: number;
	total: number;
};

export type ApplyPatchProgressCallback = (progress: ApplyPatchProgress) => Promise<void> | void;

export type ApplyPatchFailure = {
	filePath: string;
	operation: ApplyPatchOperation;
	message: string;
};

export type ApplyPatchRecoveryInstructions = {
	mustReadFiles: string[];
	mustNotReadFiles: string[];
};

export type ApplyPatchResult = {
	summaries: string[];
	appliedFiles: string[];
	failures: ApplyPatchFailure[];
	hasPartialSuccess: boolean;
	recoveryInstructions: ApplyPatchRecoveryInstructions;
	details: {
		fuzz: number;
	};
};

export type AtomicWriteOperations = {
	writeFile: (filePath: string, content: string, encoding: "utf-8") => Promise<void>;
	rename: (fromPath: string, toPath: string) => Promise<void>;
	unlink: (filePath: string) => Promise<void>;
};

export type ApplyPatchThemeColor =
	| "accent"
	| "error"
	| "muted"
	| "toolDiffAdded"
	| "toolDiffContext"
	| "toolDiffRemoved"
	| "toolOutput"
	| "toolTitle";

export type ApplyPatchThemeBg = "toolErrorBg" | "toolPendingBg" | "toolSuccessBg";

export type ApplyPatchTheme = {
	fg: (name: ApplyPatchThemeColor, text: string) => string;
	bg: (name: ApplyPatchThemeBg, text: string) => string;
	bold: (text: string) => string;
	inverse: (text: string) => string;
};

export type ApplyPatchRenderState = {
	cwd?: string;
	patchText?: string;
	callText?: string;
	collapsed?: string;
	expanded?: string;
	streamingInput?: string;
	streamingParser?: { pushDelta: (delta: string) => ParsedPatch[] };
	streamingHunks?: ParsedPatch[];
	streamingError?: string;
};

export type ApplyPatchToolDefinition = ToolDefinition<
	typeof APPLY_PATCH_PARAMS,
	ApplyPatchToolDetails | undefined,
	ApplyPatchRenderState
> & { freeform: FreeformToolFormat };

export type ApplyPatchExtensionAPI = Pick<ExtensionAPI, "on" | "getActiveTools" | "setActiveTools"> & {
	registerTool: (tool: ApplyPatchToolDefinition) => void;
};
