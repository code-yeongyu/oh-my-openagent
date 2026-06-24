import { existsSync, lstatSync, readdirSync, type Stats } from "node:fs";
import { join, resolve } from "node:path";
import { contextCwd } from "../request-context.js";
import { findWorkspaceRoot, formatServerLookupError } from "./client-wrapper.js";
import { DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_DIRECTORY_FILES } from "./constants.js";
import { effectiveExtension } from "./effective-extension.js";
import { LspInvalidPathError, LspServerLookupError } from "./errors.js";
import { filterDiagnosticsBySeverity, formatDiagnostic } from "./formatters.js";
import { getLspManager } from "./manager.js";
import { findServerForExtension } from "./server-resolution.js";
import type { Diagnostic, SeverityFilter } from "./types.js";

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);

interface FileDiagnostic {
	filePath: string;
	diagnostic: Diagnostic;
}

export function collectFilesWithExtension(dir: string, extension: string, maxFiles: number): string[] {
	const files: string[] = [];

	function walk(currentDir: string): void {
		if (files.length >= maxFiles) return;

		let entries: string[] = [];
		try {
			entries = readdirSync(currentDir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (files.length >= maxFiles) return;

			const fullPath = join(currentDir, entry);

			let stat: Stats | undefined;
			try {
				stat = lstatSync(fullPath);
			} catch {
				continue;
			}

			if (!stat || stat.isSymbolicLink()) continue;

			if (stat.isDirectory()) {
				if (!SKIP_DIRECTORIES.has(entry)) {
					walk(fullPath);
				}
			} else if (stat.isFile() && effectiveExtension(fullPath) === extension) {
				files.push(fullPath);
			}
		}
	}

	walk(dir);
	return files;
}

export async function aggregateDiagnosticsForDirectory(
	directory: string,
	extension: string,
	severity?: SeverityFilter,
	maxFiles: number = DEFAULT_MAX_DIRECTORY_FILES,
): Promise<string> {
	if (!extension.startsWith(".")) {
		throw new LspInvalidPathError(
			`Extension must start with a dot (e.g., ".ts", not "${extension}"). Use ".${extension}" instead.`,
		);
	}

	const absDir = resolve(contextCwd(), directory);
	if (!existsSync(absDir)) {
		throw new LspInvalidPathError(`Directory does not exist: ${absDir}`);
	}

	const serverResult = findServerForExtension(extension);
	if (serverResult.status !== "found") {
		throw new LspServerLookupError(formatServerLookupError(serverResult));
	}

	const server = serverResult.server;
	const allFiles = collectFilesWithExtension(absDir, extension, maxFiles + 1);
	const wasCapped = allFiles.length > maxFiles;
	const filesToProcess = allFiles.slice(0, maxFiles);

	if (filesToProcess.length === 0) {
		return [
			`Directory: ${absDir}`,
			`Extension: ${extension}`,
			"Files scanned: 0",
			`No files found with extension "${extension}".`,
		].join("\n");
	}

	const root = findWorkspaceRoot(absDir);
	const manager = getLspManager();
	const allDiagnostics: FileDiagnostic[] = [];
	const fileErrors: { file: string; error: string }[] = [];

	const client = await manager.getClient(root, server);
	try {
		for (const file of filesToProcess) {
			try {
				const result = await client.diagnostics(file);
				const filtered = filterDiagnosticsBySeverity(result.items, severity);
				allDiagnostics.push(
					...filtered.map((diagnostic) => ({
						filePath: file,
						diagnostic,
					})),
				);
			} catch (e) {
				fileErrors.push({
					file,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}
	} finally {
		manager.releaseClient(root, server.id);
	}

	const displayDiagnostics = allDiagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS);
	const wasDiagCapped = allDiagnostics.length > DEFAULT_MAX_DIAGNOSTICS;

	const lines: string[] = [
		`Directory: ${absDir}`,
		`Extension: ${extension}`,
		`Files scanned: ${filesToProcess.length}${wasCapped ? ` (capped at ${maxFiles})` : ""}`,
		`Files with errors: ${fileErrors.length}`,
		`Total diagnostics: ${allDiagnostics.length}`,
	];

	if (fileErrors.length > 0) {
		lines.push("", "File processing errors:");
		for (const { file, error } of fileErrors) {
			lines.push(`  ${file}: ${error}`);
		}
	}

	if (displayDiagnostics.length > 0) {
		lines.push("");
		for (const { filePath, diagnostic } of displayDiagnostics) {
			lines.push(`${filePath}: ${formatDiagnostic(diagnostic)}`);
		}
		if (wasDiagCapped) {
			lines.push("", `... (${allDiagnostics.length - DEFAULT_MAX_DIAGNOSTICS} more diagnostics not shown)`);
		}
	}

	return lines.join("\n");
}
