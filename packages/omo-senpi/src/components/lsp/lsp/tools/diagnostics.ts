import { resolve } from "node:path";

import { isDirectoryPath, withLspClient } from "../client-wrapper.js";
import { DEFAULT_MAX_DIAGNOSTICS } from "../constants.js";
import { aggregateDiagnosticsForDirectory } from "../directory-diagnostics.js";
import { filterDiagnosticsBySeverity, formatDiagnostic } from "../formatters.js";
import { inferExtensionFromDirectory } from "../infer-extension.js";
import { defineTool, Type } from "../schema.js";
import type { Diagnostic, SeverityFilter } from "../types.js";
import { handleMissingDependencyError } from "../utils.js";

const Params = Type.Object({
	filePath: Type.String({ description: "File or directory path to check diagnostics for" }),
	severity: Type.Optional(
		Type.Union([
			Type.Literal("error"),
			Type.Literal("warning"),
			Type.Literal("information"),
			Type.Literal("hint"),
			Type.Literal("all"),
		], {
			description: "Filter by severity level",
		}),
	),
});

export interface LspDiagnosticsDetails {
	filePath: string;
	severity: SeverityFilter;
	mode: "file" | "directory";
	diagnostics: Array<{ file: string; diagnostic: Diagnostic }>;
	totalDiagnostics: number;
	truncated: boolean;
	error?: string;
	errorKind?: "missing_dependency" | "no_files" | "invalid_path";
}

interface LspDiagnosticsParams {
	filePath: string;
	severity?: SeverityFilter;
}

type ParseDiagnosticsParamsResult =
	| { readonly ok: true; readonly params: LspDiagnosticsParams }
	| { readonly ok: false; readonly message: string };

function isSeverityFilter(value: unknown): value is SeverityFilter {
	return (
		value === "error" ||
		value === "warning" ||
		value === "information" ||
		value === "hint" ||
		value === "all"
	);
}

function parseDiagnosticsParams(params: unknown): ParseDiagnosticsParamsResult {
	if (typeof params !== "object" || params === null || Array.isArray(params)) {
		return { ok: false, message: "Invalid LSP diagnostics arguments: expected an object with filePath" };
	}
	const filePath = "filePath" in params ? params.filePath : undefined;
	if (typeof filePath !== "string" || filePath.length === 0) {
		return { ok: false, message: "Invalid LSP diagnostics arguments: filePath must be a non-empty string" };
	}
	const severity = "severity" in params ? params.severity : undefined;
	if (severity !== undefined && !isSeverityFilter(severity)) {
		return { ok: false, message: "Invalid LSP diagnostics arguments: severity is not supported" };
	}
	return severity === undefined ? { ok: true, params: { filePath } } : { ok: true, params: { filePath, severity } };
}

function invalidPathResult(message: string): {
	content: Array<{ type: "text"; text: string }>;
	details: LspDiagnosticsDetails;
} {
	return {
		content: [{ type: "text", text: message }],
		details: {
			filePath: "",
			severity: "all",
			mode: "file",
			diagnostics: [],
			totalDiagnostics: 0,
			truncated: false,
			error: message,
			errorKind: "invalid_path",
		},
	};
}

function asArray(result: { items?: Diagnostic[] } | Diagnostic[] | null | undefined): Diagnostic[] {
	if (!result) return [];
	if (Array.isArray(result)) return result;
	return result.items ?? [];
}

export const lsp_diagnostics = defineTool({
	name: "lsp_diagnostics",
	label: "LSP Diagnostics",
	description:
		"Get errors, warnings, and hints from the language server BEFORE running build. " +
		"Works for both single files and directories - file extension is auto-detected for directories.",
	parameters: Params,
	async execute(
		_toolCallId: string,
		rawParams: unknown,
		signal?: AbortSignal,
		_onUpdate?: unknown,
		_ctx?: unknown,
	) {
		const parsed = parseDiagnosticsParams(rawParams);
		if (!parsed.ok) return invalidPathResult(parsed.message);
		const params = parsed.params;
		try {
			const absPath = resolve(params.filePath);
			const severity = params.severity;

			if (isDirectoryPath(absPath)) {
				const extension = inferExtensionFromDirectory(absPath);
				if (!extension) {
					const text = `No supported source files found in directory: ${absPath}`;
					const details: LspDiagnosticsDetails = {
						filePath: params.filePath,
						severity: severity ?? "all",
						mode: "directory",
						diagnostics: [],
						totalDiagnostics: 0,
						truncated: false,
						error: text,
						errorKind: "no_files",
					};
					return {
						content: [{ type: "text", text }],
						details,
					};
				}

				const text = await aggregateDiagnosticsForDirectory(absPath, extension, severity);
				const details: LspDiagnosticsDetails = {
					filePath: params.filePath,
					severity: severity ?? "all",
					mode: "directory",
					diagnostics: [],
					totalDiagnostics: 0,
					truncated: false,
				};
				return {
					content: [{ type: "text", text }],
					details,
				};
			}

			const result = await withLspClient<{ items?: Diagnostic[] } | Diagnostic[] | null | undefined>(
				params.filePath,
				async (client) => client.diagnostics(params.filePath),
				"diagnostics",
				signal === undefined ? {} : { signal },
			);

			let diagnostics = asArray(result);
			diagnostics = filterDiagnosticsBySeverity(diagnostics, severity);

			const total = diagnostics.length;
			const truncated = total > DEFAULT_MAX_DIAGNOSTICS;
			const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics;

			let text: string;
			if (total === 0) {
				text = "No diagnostics found";
			} else {
				const lines = limited.map(formatDiagnostic);
				if (truncated) {
					lines.unshift(`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`);
				}
				text = lines.join("\n");
			}

			const details: LspDiagnosticsDetails = {
				filePath: params.filePath,
				severity: severity ?? "all",
				mode: "file",
				diagnostics: diagnostics.map((diagnostic) => ({ file: absPath, diagnostic })),
				totalDiagnostics: total,
				truncated,
			};

			return {
				content: [{ type: "text", text }],
				details,
			};
		} catch (e) {
			const message = handleMissingDependencyError(e);

			if (message) {
				const details: LspDiagnosticsDetails = {
					filePath: params.filePath,
					severity: params.severity ?? "all",
					mode: "file",
					diagnostics: [],
					totalDiagnostics: 0,
					truncated: false,
					error: message,
					errorKind: "missing_dependency",
				};
				return {
					content: [{ type: "text", text: message }],
					details,
				};
			}

			throw e;
		}
	},
});
