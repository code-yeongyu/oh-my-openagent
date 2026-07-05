import { withLspClient } from "../client-wrapper.js";
import { formatLocation } from "../formatters.js";
import { defineTool, Type } from "../schema.js";
import type { Location, LocationLink } from "../types.js";
import { handleMissingDependencyError } from "../utils.js";

const Params = Type.Object({
	filePath: Type.String({ description: "Path to the source file containing the symbol" }),
	line: Type.Number({ description: "1-based line number of the symbol" }),
	character: Type.Number({ description: "0-based column of the symbol on that line" }),
});

export interface LspGotoDefinitionDetails {
	filePath: string;
	line: number;
	character: number;
	locations: Array<Location | LocationLink>;
	error?: string;
	errorKind?: "missing_dependency";
}

interface LspGotoDefinitionParams {
	filePath: string;
	line: number;
	character: number;
}

export const lsp_goto_definition = defineTool({
	name: "lsp_goto_definition",
	label: "LSP Goto Definition",
	description: "Jump to symbol definition. Find WHERE something is defined.",
	parameters: Params,
	async execute(
		_toolCallId: string,
		params: LspGotoDefinitionParams,
		signal?: AbortSignal,
		_onUpdate?: unknown,
		_ctx?: unknown,
	) {
		try {
			const result = await withLspClient<Location | LocationLink | Array<Location | LocationLink> | null>(
				params.filePath,
				async (client) => client.definition(params.filePath, params.line, params.character),
				"definition",
				signal === undefined ? {} : { signal },
			);

			const locations = !result ? [] : Array.isArray(result) ? result : [result];

			if (locations.length === 0) {
				return {
					content: [{ type: "text", text: "No definition found" }],
					details: {
						filePath: params.filePath,
						line: params.line,
						character: params.character,
						locations: [],
					} satisfies LspGotoDefinitionDetails,
				};
			}

			const text = locations.map(formatLocation).join("\n");
			return {
				content: [{ type: "text", text }],
				details: {
					filePath: params.filePath,
					line: params.line,
					character: params.character,
					locations,
				} satisfies LspGotoDefinitionDetails,
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
						locations: [],
						error: message,
						errorKind: "missing_dependency",
					} satisfies LspGotoDefinitionDetails,
				};
			}
			throw e;
		}
	},
});
