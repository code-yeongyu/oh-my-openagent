import { withLspClient } from "../client-wrapper.js";
import { DEFAULT_MAX_REFERENCES } from "../constants.js";
import { formatLocation } from "../formatters.js";
import { defineTool, Type } from "../schema.js";
import type { Location } from "../types.js";
import { handleMissingDependencyError } from "../utils.js";

const Params = Type.Object({
	filePath: Type.String({ description: "Path to the source file" }),
	line: Type.Number({ description: "1-based line of the symbol" }),
	character: Type.Number({ description: "0-based column of the symbol on that line" }),
	includeDeclaration: Type.Optional(Type.Boolean({ description: "Include the declaration itself (default: true)" })),
});

export interface LspFindReferencesDetails {
	filePath: string;
	line: number;
	character: number;
	references: Location[];
	totalReferences: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency";
}

interface LspFindReferencesParams {
	filePath: string;
	line: number;
	character: number;
	includeDeclaration?: boolean;
}

export const lsp_find_references = defineTool({
	name: "lsp_find_references",
	label: "LSP Find References",
	description: "Find ALL usages/references of a symbol across the entire workspace.",
	parameters: Params,
	async execute(
		_toolCallId: string,
		params: LspFindReferencesParams,
		signal?: AbortSignal,
		_onUpdate?: unknown,
		_ctx?: unknown,
	) {
		try {
			const result = await withLspClient<Location[]>(
				params.filePath,
				async (client) =>
					client.references(params.filePath, params.line, params.character, params.includeDeclaration ?? true),
				"references",
				signal === undefined ? {} : { signal },
			);

			const all = Array.isArray(result) ? result : [];
			const total = all.length;
			const truncated = total > DEFAULT_MAX_REFERENCES;
			const limited = truncated ? all.slice(0, DEFAULT_MAX_REFERENCES) : all;

			if (total === 0) {
				return {
					content: [{ type: "text", text: "No references found" }],
					details: {
						filePath: params.filePath,
						line: params.line,
						character: params.character,
						references: [],
						totalReferences: 0,
						truncated: false,
					} satisfies LspFindReferencesDetails,
				};
			}

			const lines = limited.map(formatLocation);
			if (truncated) {
				lines.unshift(`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`);
			}
			const text = lines.join("\n");
			return {
				content: [{ type: "text", text }],
				details: {
					filePath: params.filePath,
					line: params.line,
					character: params.character,
					references: all,
					totalReferences: total,
					truncated,
				} satisfies LspFindReferencesDetails,
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
						references: [],
						totalReferences: 0,
						truncated: false,
						error: message,
						errorKind: "missing_dependency",
					} satisfies LspFindReferencesDetails,
				};
			}
			throw e;
		}
	},
});
