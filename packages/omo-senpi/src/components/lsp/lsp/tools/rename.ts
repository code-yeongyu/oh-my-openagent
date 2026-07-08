import { withLspClient } from "../client-wrapper.js";
import { formatApplyResult, formatPrepareRenameResult } from "../formatters.js";
import { defineTool, Type } from "../schema.js";
import type { PrepareRenameDefaultBehavior, PrepareRenameResult, Range, WorkspaceEdit } from "../types.js";
import { handleMissingDependencyError } from "../utils.js";
import { type ApplyResult, applyWorkspaceEdit } from "../workspace-edit.js";

const PrepareParams = Type.Object({
	filePath: Type.String({ description: "Path to the source file" }),
	line: Type.Number({ description: "1-based line of the symbol" }),
	character: Type.Number({ description: "0-based column of the symbol on that line" }),
});

const RenameParams = Type.Object({
	filePath: Type.String({ description: "Path to the source file" }),
	line: Type.Number({ description: "1-based line of the symbol" }),
	character: Type.Number({ description: "0-based column of the symbol on that line" }),
	newName: Type.String({ description: "New symbol name" }),
});

export interface LspPrepareRenameDetails {
	filePath: string;
	line: number;
	character: number;
	result: PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null;
	error?: string;
	errorKind?: "missing_dependency";
}

export interface LspRenameDetails {
	filePath: string;
	line: number;
	character: number;
	newName: string;
	apply: ApplyResult | null;
	edit: WorkspaceEdit | null;
	error?: string;
	errorKind?: "missing_dependency";
}

interface LspPositionParams {
	filePath: string;
	line: number;
	character: number;
}

interface LspRenameParams extends LspPositionParams {
	newName: string;
}

export const lsp_prepare_rename = defineTool({
	name: "lsp_prepare_rename",
	label: "LSP Prepare Rename",
	description: "Check if rename is valid at a given position. Use BEFORE lsp_rename.",
	parameters: PrepareParams,
	async execute(
		_toolCallId: string,
		params: LspPositionParams,
		signal?: AbortSignal,
		_onUpdate?: unknown,
		_ctx?: unknown,
	) {
		try {
			const result = await withLspClient<PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null>(
				params.filePath,
				async (client) => client.prepareRename(params.filePath, params.line, params.character),
				"prepareRename",
				signal === undefined ? {} : { signal },
			);

			const text = formatPrepareRenameResult(result);
			return {
				content: [{ type: "text", text }],
				details: {
					filePath: params.filePath,
					line: params.line,
					character: params.character,
					result,
				} satisfies LspPrepareRenameDetails,
			};
		} catch (e) {
			const message = handleMissingDependencyError(e);
			if (message) {
				return {
					content: [{ type: "text", text: message }],
					details: {
						filePath: params.filePath,
						line: params.line,
						character: params.character,
						result: null,
						error: message,
						errorKind: "missing_dependency",
					} satisfies LspPrepareRenameDetails,
				};
			}
			throw e;
		}
	},
});

export const lsp_rename = defineTool({
	name: "lsp_rename",
	label: "LSP Rename",
	description: "Rename symbol across the entire workspace. APPLIES changes to all files.",
	parameters: RenameParams,
	executionMode: "sequential",
	async execute(_toolCallId: string, params: LspRenameParams, signal?: AbortSignal, _onUpdate?: unknown, _ctx?: unknown) {
		try {
			const edit = await withLspClient<WorkspaceEdit | null>(
				params.filePath,
				async (client) => client.rename(params.filePath, params.line, params.character, params.newName),
				"rename",
				signal === undefined ? {} : { signal },
			);

			const apply = applyWorkspaceEdit(edit);
			const text = formatApplyResult(apply);
			return {
				content: [{ type: "text", text }],
				details: {
					filePath: params.filePath,
					line: params.line,
					character: params.character,
					newName: params.newName,
					apply,
					edit,
				} satisfies LspRenameDetails,
			};
		} catch (e) {
			const message = handleMissingDependencyError(e);
			if (message) {
				return {
					content: [{ type: "text", text: message }],
					details: {
						filePath: params.filePath,
						line: params.line,
						character: params.character,
						newName: params.newName,
						apply: null,
						edit: null,
						error: message,
						errorKind: "missing_dependency",
					} satisfies LspRenameDetails,
				};
			}
			throw e;
		}
	},
});
