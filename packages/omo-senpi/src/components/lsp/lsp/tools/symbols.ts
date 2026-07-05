import { withLspClient } from "../client-wrapper.js";
import { DEFAULT_MAX_SYMBOLS } from "../constants.js";
import { formatDocumentSymbol, formatSymbolInfo } from "../formatters.js";
import { defineTool, Type } from "../schema.js";
import type { DocumentSymbol, SymbolInfo } from "../types.js";
import { handleMissingDependencyError } from "../utils.js";

const Params = Type.Object({
	filePath: Type.String({ description: "File path used as LSP context" }),
	scope: Type.Union([Type.Literal("document"), Type.Literal("workspace")], {
		description: "'document' for file symbols, 'workspace' for project-wide search",
	}),
	query: Type.Optional(Type.String({ description: "Symbol name to search (required for workspace scope)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (default: 200)" })),
});

function isDocumentSymbol(symbol: DocumentSymbol | SymbolInfo): symbol is DocumentSymbol {
	return "range" in symbol;
}

export interface LspSymbolsDetails {
	filePath: string;
	scope: "document" | "workspace";
	query?: string;
	symbols: Array<DocumentSymbol | SymbolInfo>;
	totalSymbols: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency" | "missing_query";
}

interface LspSymbolsParams {
	filePath: string;
	scope: "document" | "workspace";
	query?: string;
	limit?: number;
}

export const lsp_symbols = defineTool({
	name: "lsp_symbols",
	label: "LSP Symbols",
	description:
		"Get symbols from a file (document) or search across the workspace. " +
		"Use scope='document' for a file outline, scope='workspace' for project-wide symbol search.",
	parameters: Params,
	async execute(
		_toolCallId: string,
		params: LspSymbolsParams,
		signal?: AbortSignal,
		_onUpdate?: unknown,
		_ctx?: unknown,
	) {
		const scope = params.scope;
		try {
			if (scope === "workspace") {
				if (!params.query) {
					const text = "Error: 'query' is required for workspace scope";
					return {
						content: [{ type: "text", text }],
						details: {
							filePath: params.filePath,
							scope,
							symbols: [],
							totalSymbols: 0,
							truncated: false,
							error: text,
							errorKind: "missing_query",
						} satisfies LspSymbolsDetails,
					};
				}

				const query = params.query;

				const result = await withLspClient<SymbolInfo[]>(
					params.filePath,
					async (client) => client.workspaceSymbols(query),
					"workspaceSymbols",
					signal === undefined ? {} : { signal },
				);

				const all = result;
				const total = all.length;
				const limit = Math.min(params.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS);
				const truncated = total > limit;
				const limited = truncated ? all.slice(0, limit) : all;

				if (total === 0) {
					return {
						content: [{ type: "text", text: "No symbols found" }],
						details: {
							filePath: params.filePath,
							scope,
							query,
							symbols: [],
							totalSymbols: 0,
							truncated: false,
						} satisfies LspSymbolsDetails,
					};
				}

				const lines = limited.map(formatSymbolInfo);
				if (truncated) {
					lines.unshift(`Found ${total} symbols (showing first ${limit}):`);
				}
				const text = lines.join("\n");
				return {
					content: [{ type: "text", text }],
					details: {
						filePath: params.filePath,
						scope,
						query,
						symbols: all,
						totalSymbols: total,
						truncated,
					} satisfies LspSymbolsDetails,
				};
			}

			const result = await withLspClient<Array<DocumentSymbol | SymbolInfo>>(
				params.filePath,
				async (client) => client.documentSymbols(params.filePath),
				"documentSymbols",
				signal === undefined ? {} : { signal },
			);

			const all = result;
			const total = all.length;
			const limit = Math.min(params.limit ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS);
			const truncated = total > limit;
			const limited = truncated ? all.slice(0, limit) : all;

			if (total === 0) {
				return {
					content: [{ type: "text", text: "No symbols found" }],
					details: {
						filePath: params.filePath,
						scope,
						symbols: [],
						totalSymbols: 0,
						truncated: false,
					} satisfies LspSymbolsDetails,
				};
			}

			const lines: string[] = [];
			if (truncated) {
				lines.push(`Found ${total} symbols (showing first ${limit}):`);
			}

			const documentSymbols = limited.filter(isDocumentSymbol);
			if (documentSymbols.length === limited.length) {
				lines.push(...documentSymbols.map((s) => formatDocumentSymbol(s)));
			} else {
				lines.push(
					...limited.filter((symbol): symbol is SymbolInfo => !isDocumentSymbol(symbol)).map(formatSymbolInfo),
				);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					filePath: params.filePath,
					scope,
					symbols: all,
					totalSymbols: total,
					truncated,
				} satisfies LspSymbolsDetails,
			};
		} catch (e) {
			const message = handleMissingDependencyError(e);
			if (message) {
				const details: LspSymbolsDetails = {
					filePath: params.filePath,
					scope,
					symbols: [],
					totalSymbols: 0,
					truncated: false,
					error: message,
					errorKind: "missing_dependency",
				};
				if (params.query !== undefined) details.query = params.query;
				return {
					content: [{ type: "text", text: message }],
					details,
				};
			}
			throw e;
		}
	},
});
