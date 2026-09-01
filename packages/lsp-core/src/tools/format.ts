import { withLspClient } from "../lsp/client-wrapper.js";
import { type FormatDocumentResult, formatDocumentWithClient } from "../lsp/format-document.js";
import { missingDependencyResult } from "../missing-dependency-result.js";
import { clientOptions, requireString } from "./parameters.js";
import { text } from "./result.js";
import type { LspFormatDetails, ToolExecutionResult } from "./types.js";

export async function executeLspFormat(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");

	try {
		const result = await withLspClient(
			filePath,
			async (client, _workspaceRoot, resolvedFilePath) =>
				formatDocumentWithClient(client, resolvedFilePath, signal === undefined ? {} : { signal }),
			"format",
			clientOptions(signal),
		);
		return text(describeResult(filePath, result), formatDetails(filePath, result));
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			status: "unavailable",
			reason: "server_unavailable",
			linesAdded: 0,
			linesRemoved: 0,
		} satisfies Omit<LspFormatDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}

function formatDetails(filePath: string, result: FormatDocumentResult): LspFormatDetails {
	if (result.status === "unavailable") {
		return { filePath, status: "unavailable", reason: result.reason, linesAdded: 0, linesRemoved: 0 };
	}
	return {
		filePath,
		status: result.status,
		linesAdded: result.linesAdded,
		linesRemoved: result.linesRemoved,
	};
}

function describeResult(filePath: string, result: FormatDocumentResult): string {
	if (result.status === "unavailable") {
		return `Formatting unavailable for ${filePath}: the language server does not advertise documentFormattingProvider.`;
	}
	if (result.status === "unchanged") {
		return `Already formatted: ${filePath}`;
	}
	return `Formatted ${filePath} (+${result.linesAdded}/-${result.linesRemoved} lines)`;
}
