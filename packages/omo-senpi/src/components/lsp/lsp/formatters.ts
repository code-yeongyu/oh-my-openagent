import { fileURLToPath } from "node:url";

import { SEVERITY_MAP, SYMBOL_KIND_MAP } from "./language-mappings.js";
import type {
	Diagnostic,
	DocumentSymbol,
	Location,
	LocationLink,
	PrepareRenameDefaultBehavior,
	PrepareRenameResult,
	Range,
	SeverityFilter,
	SymbolInfo,
} from "./types.js";
import type { ApplyResult } from "./workspace-edit.js";

export function uriToPath(uri: string): string {
	return fileURLToPath(uri);
}

export function formatLocation(loc: Location | LocationLink): string {
	if ("targetUri" in loc) {
		const uri = uriToPath(loc.targetUri);
		const line = loc.targetRange.start.line + 1;
		const char = loc.targetRange.start.character;
		return `${uri}:${line}:${char}`;
	}

	const uri = uriToPath(loc.uri);
	const line = loc.range.start.line + 1;
	const char = loc.range.start.character;
	return `${uri}:${line}:${char}`;
}

export function formatSymbolKind(kind: number): string {
	return SYMBOL_KIND_MAP[kind] ?? `Unknown(${kind})`;
}

export function formatSeverity(severity: number | undefined): string {
	if (!severity) return "unknown";
	return SEVERITY_MAP[severity] ?? `unknown(${severity})`;
}

export function formatDocumentSymbol(symbol: DocumentSymbol, indent = 0): string {
	const prefix = "  ".repeat(indent);
	const kind = formatSymbolKind(symbol.kind);
	const line = symbol.range.start.line + 1;
	let result = `${prefix}${symbol.name} (${kind}) - line ${line}`;

	if (symbol.children && symbol.children.length > 0) {
		for (const child of symbol.children) {
			result += `\n${formatDocumentSymbol(child, indent + 1)}`;
		}
	}

	return result;
}

export function formatSymbolInfo(symbol: SymbolInfo): string {
	const kind = formatSymbolKind(symbol.kind);
	const loc = formatLocation(symbol.location);
	const container = symbol.containerName ? ` (in ${symbol.containerName})` : "";
	return `${symbol.name} (${kind})${container} - ${loc}`;
}

export function formatDiagnostic(diag: Diagnostic): string {
	const severity = formatSeverity(diag.severity);
	const line = diag.range.start.line + 1;
	const char = diag.range.start.character;
	const source = diag.source ? `[${diag.source}]` : "";
	const code = diag.code ? ` (${diag.code})` : "";
	return `${severity}${source}${code} at ${line}:${char}: ${diag.message}`;
}

export function filterDiagnosticsBySeverity(diagnostics: Diagnostic[], severityFilter?: SeverityFilter): Diagnostic[] {
	if (!severityFilter || severityFilter === "all") {
		return diagnostics;
	}

	const severityMap: Record<string, number> = {
		error: 1,
		warning: 2,
		information: 3,
		hint: 4,
	};

	const targetSeverity = severityMap[severityFilter];
	if (targetSeverity === undefined) return diagnostics;
	return diagnostics.filter((d) => d.severity === targetSeverity);
}

export function formatPrepareRenameResult(
	result: PrepareRenameResult | PrepareRenameDefaultBehavior | Range | null,
): string {
	if (!result) return "Cannot rename at this position";

	if ("defaultBehavior" in result) {
		return result.defaultBehavior ? "Rename supported (using default behavior)" : "Cannot rename at this position";
	}

	if ("range" in result && result.range) {
		const startLine = result.range.start.line + 1;
		const startChar = result.range.start.character;
		const endLine = result.range.end.line + 1;
		const endChar = result.range.end.character;
		const placeholder = result.placeholder ? ` (current: "${result.placeholder}")` : "";
		return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}${placeholder}`;
	}

	if ("start" in result && "end" in result) {
		const startLine = result.start.line + 1;
		const startChar = result.start.character;
		const endLine = result.end.line + 1;
		const endChar = result.end.character;
		return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}`;
	}

	return "Cannot rename at this position";
}

export function formatApplyResult(result: ApplyResult): string {
	const lines: string[] = [];

	if (result.success) {
		lines.push(`Applied ${result.totalEdits} edit(s) to ${result.filesModified.length} file(s):`);
		for (const file of result.filesModified) {
			lines.push(`  - ${file}`);
		}
	} else {
		lines.push("Failed to apply some changes:");
		for (const err of result.errors) {
			lines.push(`  Error: ${err}`);
		}
		if (result.filesModified.length > 0) {
			lines.push(`Successfully modified: ${result.filesModified.join(", ")}`);
		}
	}

	return lines.join("\n");
}
