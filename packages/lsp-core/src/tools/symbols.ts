import { DEFAULT_MAX_SYMBOLS } from "../lsp/constants.js";
import { formatDocumentSymbol, formatSymbolInfo } from "../lsp/formatters.js";
import { withLspClient } from "../lsp/client-wrapper.js";
import type { DocumentSymbol, SymbolInfo } from "../lsp/types.js";
import { missingDependencyResult } from "../missing-dependency-result.js";
import { clientOptions, optionalNumber, optionalString, requireString } from "./parameters.js";
import { text } from "./result.js";
import type { LspSymbolsDetails, ToolExecutionResult } from "./types.js";

function isDocumentSymbol(symbol: DocumentSymbol | SymbolInfo): symbol is DocumentSymbol {
	return "range" in symbol;
}

export function normalizeSymbolLimit(limit: number | undefined): number {
	if (limit === undefined || limit < 1) {
		return DEFAULT_MAX_SYMBOLS;
	}
	return Math.min(Math.floor(limit), DEFAULT_MAX_SYMBOLS);
}

export async function executeLspSymbols(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const rawScope = optionalString(params, "scope") ?? "document";
	const scope = rawScope === "workspace" ? "workspace" : "document";
	const limit = normalizeSymbolLimit(optionalNumber(params, "limit"));

	try {
		if (scope === "workspace") {
			const query = optionalString(params, "query");
			if (!query) {
				const message = "Error: 'query' is required for workspace scope";
				return text(message, {
					filePath,
					scope,
					symbols: [],
					totalSymbols: 0,
					truncated: false,
					error: message,
					errorKind: "missing_query",
				});
			}

				const symbols = await withLspClient(
					filePath,
					async (client) => client.workspaceSymbols(query, signal),
					"workspaceSymbols",
					clientOptions(signal),
				);
			return formatSymbolsResult(filePath, scope, symbols, limit, query);
		}

			const symbols = await withLspClient(
				filePath,
				async (client) => client.documentSymbols(filePath, signal),
				"documentSymbols",
				clientOptions(signal),
			);
		return formatSymbolsResult(filePath, scope, symbols, limit);
	} catch (error) {
		const query = optionalString(params, "query");
		const missingDependency = missingDependencyResult(error, {
			filePath,
			scope,
			symbols: [],
			totalSymbols: 0,
			truncated: false,
			...(query === undefined ? {} : { query }),
		} satisfies Omit<LspSymbolsDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

function formatSymbolsResult(
	filePath: string,
	scope: "document" | "workspace",
	symbols: Array<DocumentSymbol | SymbolInfo>,
	limit: number,
	query?: string,
): ToolExecutionResult {
	const total = symbols.length;
	const truncated = total > limit;
	const limited = truncated ? symbols.slice(0, limit) : symbols;
	const details: LspSymbolsDetails = {
		filePath,
		scope,
		symbols,
		totalSymbols: total,
		truncated,
		...(query === undefined ? {} : { query }),
	};
	if (total === 0) return text("No symbols found", details);

	const lines: string[] = [];
	if (truncated) lines.push(`Found ${total} symbols (showing first ${limit}):`);
	const documentSymbols = limited.filter(isDocumentSymbol);
	if (documentSymbols.length === limited.length) {
		lines.push(...documentSymbols.map((symbol) => formatDocumentSymbol(symbol)));
	} else {
		lines.push(...limited.filter((symbol): symbol is SymbolInfo => !isDocumentSymbol(symbol)).map(formatSymbolInfo));
	}
	return text(lines.join("\n"), details);
}
