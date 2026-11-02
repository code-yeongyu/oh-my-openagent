import { parseBunCheckOutput, parseBunLintJson, type FileDiagnostic } from "../lsp/bun-command-output.js";
import { type BunProjectChecksOptions, resolveBunProjectCommand, runBunCommand } from "../lsp/bun-project-checks.js";
import { DEFAULT_MAX_DIAGNOSTICS } from "../lsp/constants.js";
import { filterDiagnosticsBySeverity, formatDiagnostic } from "../lsp/formatters.js";
import type { SeverityFilter } from "../lsp/types.js";

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export interface BunDirectoryDiagnostics {
	readonly output: string;
	readonly diagnostics: readonly FileDiagnostic[];
	readonly projectCommands: readonly string[];
}

export async function runBunDirectoryDiagnostics(
	absDir: string,
	extension: string,
	severity: SeverityFilter | undefined,
	signal: AbortSignal | undefined,
	options: BunProjectChecksOptions = {},
): Promise<BunDirectoryDiagnostics | undefined> {
	if (!TYPESCRIPT_EXTENSIONS.has(extension)) return undefined;
	const checkBun = await resolveBunProjectCommand("check", absDir, options);
	if (checkBun === undefined) return undefined;

	let typecheck: FileDiagnostic[];
	try {
		const run = await runBunCommand(checkBun, ["check", "--no-pretty", "."], absDir, signal);
		typecheck = parseBunCheckOutput(run.stdout, absDir);
		const failedWithoutDiagnostics = run.exitCode === 1 && typecheck.length === 0;
		if ((run.exitCode !== 0 && run.exitCode !== 1) || failedWithoutDiagnostics) return undefined;
	} catch (error) {
		if (signal?.aborted) throw error;
		return undefined;
	}

	const header = [`Directory: ${absDir}`, "Typecheck: bun check (files in this directory and everything they import)"];
	const projectCommands = ["bun check"];
	const collected = [...typecheck];
	const lintBun = await resolveBunProjectCommand("lint", absDir, options);
	if (lintBun !== undefined) {
		const lint = await runBunLint(lintBun, absDir, signal);
		header.push(lint.status);
		projectCommands.push("bun lint");
		collected.push(...lint.diagnostics);
	}

	const diagnostics = collected.filter(({ diagnostic }) => filterDiagnosticsBySeverity([diagnostic], severity).length > 0);
	const lines = [...header, `Total diagnostics: ${diagnostics.length}`];
	const shown = diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS);
	if (shown.length > 0) {
		lines.push("", ...shown.map(({ file, diagnostic }) => `${file}: ${formatDiagnostic(diagnostic)}`));
		if (diagnostics.length > shown.length) {
			lines.push("", `... (${diagnostics.length - shown.length} more diagnostics not shown)`);
		}
	}
	return { output: lines.join("\n"), diagnostics, projectCommands };
}

async function runBunLint(
	bunPath: string,
	absDir: string,
	signal: AbortSignal | undefined,
): Promise<{ status: string; diagnostics: FileDiagnostic[] }> {
	try {
		const run = await runBunCommand(bunPath, ["lint", "-f", "json", "."], absDir, signal);
		const diagnostics = run.exitCode === 0 || run.exitCode === 1 ? parseBunLintJson(run.stdout) : undefined;
		if (diagnostics !== undefined) return { status: "Lint: bun lint", diagnostics };
		const reason = run.stderr.trim().split(/\r?\n/)[0] ?? "";
		return { status: `Lint: bun lint could not lint (exit ${run.exitCode ?? "signal"})${reason ? `: ${reason}` : ""}`, diagnostics: [] };
	} catch (error) {
		if (signal?.aborted) throw error;
		return { status: `Lint: bun lint could not run: ${error instanceof Error ? error.message : String(error)}`, diagnostics: [] };
	}
}
