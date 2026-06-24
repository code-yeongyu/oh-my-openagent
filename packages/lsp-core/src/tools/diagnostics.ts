import { resolve } from "node:path";

import { isDirectoryPath, withLspClient } from "../lsp/client-wrapper.js";
import { DEFAULT_MAX_DIAGNOSTICS } from "../lsp/constants.js";
import { aggregateDiagnosticsForDirectory } from "../lsp/directory-diagnostics.js";
import { filterDiagnosticsBySeverity, formatDiagnostic } from "../lsp/formatters.js";
import { inferExtensionFromDirectory } from "../lsp/infer-extension.js";
import type { Diagnostic } from "../lsp/types.js";
import { missingDependencyResult } from "../missing-dependency-result.js";
import { contextCwd } from "../request-context.js";
import { clientOptions, requireString, severityFilter } from "./parameters.js";
import { text } from "./result.js";
import type { LspDiagnosticsDetails, ToolExecutionResult } from "./types.js";

function asDiagnosticArray(result: { items?: Diagnostic[] } | Diagnostic[] | null | undefined): Diagnostic[] {
	if (!result) return [];
	if (Array.isArray(result)) return result;
	return result.items ?? [];
}

export async function executeLspDiagnostics(
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<ToolExecutionResult> {
	const filePath = requireString(params, "filePath");
	const severity = severityFilter(params);

	try {
		const absPath = resolve(contextCwd(), filePath);
		if (isDirectoryPath(absPath)) {
			const extension = inferExtensionFromDirectory(absPath);
			if (!extension) {
				const message = `No supported source files found in directory: ${absPath}`;
				const details: LspDiagnosticsDetails = {
					filePath,
					severity,
					mode: "directory",
					diagnostics: [],
					totalDiagnostics: 0,
					truncated: false,
					error: message,
					errorKind: "no_files",
				};
				return text(message, details);
			}

			const output = await aggregateDiagnosticsForDirectory(absPath, extension, severity);
			const details: LspDiagnosticsDetails = {
				filePath,
				severity,
				mode: "directory",
				diagnostics: [],
				totalDiagnostics: 0,
				truncated: false,
			};
			return text(output, details);
		}

		const result = await withLspClient(
			filePath,
			async (client) => client.diagnostics(filePath),
			"diagnostics",
			clientOptions(signal),
		);
		const diagnostics = filterDiagnosticsBySeverity(asDiagnosticArray(result), severity);
		const total = diagnostics.length;
		const truncated = total > DEFAULT_MAX_DIAGNOSTICS;
		const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics;
		const output =
			total === 0
				? "No diagnostics found"
				: [
						...(truncated ? [`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`] : []),
						...limited.map(formatDiagnostic),
					].join("\n");
		const details: LspDiagnosticsDetails = {
			filePath,
			severity,
			mode: "file",
			diagnostics: diagnostics.map((diagnostic) => ({ file: absPath, diagnostic })),
			totalDiagnostics: total,
			truncated,
		};
		return text(output, details);
	} catch (error) {
		const missingDependency = missingDependencyResult(error, {
			filePath,
			severity,
			mode: "file",
			diagnostics: [],
			totalDiagnostics: 0,
			truncated: false,
		} satisfies Omit<LspDiagnosticsDetails, "error" | "errorKind">);
		if (missingDependency) return missingDependency;
		throw error;
	}
}
