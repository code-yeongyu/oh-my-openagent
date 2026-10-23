import { resolve } from "node:path";
import type { Diagnostic } from "./types.js";

export interface FileDiagnostic {
	readonly file: string;
	readonly diagnostic: Diagnostic;
}

const TSC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/;
const TSC_SEVERITY: Record<string, number> = { error: 1, warning: 2, message: 3 };

export function parseBunCheckOutput(stdout: string, cwd: string): FileDiagnostic[] {
	const results: Array<{ file: string; diagnostic: Diagnostic }> = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = TSC_LINE.exec(line);
		if (match) {
			const [, path, lineNumber, column, severity, code, message] = match;
			const start = { line: Number(lineNumber) - 1, character: Number(column) - 1 };
			results.push({
				file: resolve(cwd, path ?? ""),
				diagnostic: {
					range: { start, end: start },
					severity: TSC_SEVERITY[severity ?? "error"] ?? 1,
					code: code ?? "",
					source: "bun check",
					message: message ?? "",
				},
			});
			continue;
		}
		const previous = results[results.length - 1];
		if (previous !== undefined && /^\s+\S/.test(line)) {
			previous.diagnostic.message = `${previous.diagnostic.message}\n${line.trim()}`;
		}
	}
	return results;
}

interface EslintJsonMessage {
	readonly ruleId?: string | null;
	readonly severity?: number;
	readonly message?: string;
	readonly line?: number;
	readonly column?: number;
	readonly endLine?: number;
	readonly endColumn?: number;
}

export function parseBunLintJson(stdout: string): FileDiagnostic[] | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed)) return undefined;
	const results: FileDiagnostic[] = [];
	for (const entry of parsed) {
		if (entry === null || typeof entry !== "object") continue;
		const filePath = (entry as { filePath?: unknown }).filePath;
		const messages = (entry as { messages?: unknown }).messages;
		if (typeof filePath !== "string" || !Array.isArray(messages)) continue;
		for (const raw of messages as EslintJsonMessage[]) {
			const start = { line: Math.max(0, (raw.line ?? 1) - 1), character: Math.max(0, (raw.column ?? 1) - 1) };
			const end = {
				line: raw.endLine === undefined ? start.line : Math.max(0, raw.endLine - 1),
				character: raw.endColumn === undefined ? start.character : Math.max(0, raw.endColumn - 1),
			};
			results.push({
				file: filePath,
				diagnostic: {
					range: { start, end },
					severity: raw.severity === 2 ? 1 : 2,
					...(raw.ruleId ? { code: raw.ruleId } : {}),
					source: "bun lint",
					message: raw.message ?? "",
				},
			});
		}
	}
	return results;
}
