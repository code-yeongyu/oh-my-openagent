import { existsSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { contextCwd } from "../request-context.js";
import type { TextEdit, WorkspaceEdit } from "./types.js";

export interface ApplyResult {
	success: boolean;
	filesModified: string[];
	totalEdits: number;
	errors: string[];
}

interface FileApplyResult {
	success: boolean;
	editCount: number;
	error?: string;
}

export interface ApplyWorkspaceEditOptions {
	readonly workspaceRoot?: string;
}

type PathValidationResult =
	| { readonly success: true; readonly path: string }
	| { readonly success: false; readonly error: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isPathInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
	const relativePath = relative(workspaceRoot, filePath);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function realpathForValidation(filePath: string): string {
	if (existsSync(filePath)) return realpathSync(filePath);
	const parent = dirname(filePath);
	return resolve(realpathSync(parent), relative(parent, filePath));
}

function uriToWorkspacePath(uri: string, workspaceRoot: string): PathValidationResult {
	let filePath: string;
	try {
		filePath = fileURLToPath(uri);
	} catch (error) {
		return { success: false, error: `non-file URI ${uri}: ${errorMessage(error)}` };
	}

	let validatedPath: string;
	try {
		validatedPath = realpathForValidation(filePath);
	} catch (error) {
		return { success: false, error: `${filePath}: ${errorMessage(error)}` };
	}

	if (!isPathInsideWorkspace(validatedPath, workspaceRoot)) {
		return { success: false, error: `${filePath}: outside workspace ${workspaceRoot}` };
	}

	return { success: true, path: filePath };
}

function applyTextEditsToFile(filePath: string, edits: TextEdit[]): FileApplyResult {
	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		const sortedEdits = [...edits].sort((a, b) => {
			if (b.range.start.line !== a.range.start.line) {
				return b.range.start.line - a.range.start.line;
			}
			return b.range.start.character - a.range.start.character;
		});

		for (const edit of sortedEdits) {
			const startLine = edit.range.start.line;
			const startChar = edit.range.start.character;
			const endLine = edit.range.end.line;
			const endChar = edit.range.end.character;

			if (startLine === endLine) {
				const line = lines[startLine] ?? "";
				lines[startLine] = line.substring(0, startChar) + edit.newText + line.substring(endChar);
			} else {
				const firstLine = lines[startLine] ?? "";
				const lastLine = lines[endLine] ?? "";
				const newContent = firstLine.substring(0, startChar) + edit.newText + lastLine.substring(endChar);
				lines.splice(startLine, endLine - startLine + 1, ...newContent.split("\n"));
			}
		}

		writeFileSync(filePath, lines.join("\n"), "utf-8");
		return { success: true, editCount: edits.length };
	} catch (err) {
		return {
			success: false,
			editCount: 0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function applyWorkspaceEdit(edit: WorkspaceEdit | null, options: ApplyWorkspaceEditOptions = {}): ApplyResult {
	if (!edit) {
		return { success: false, filesModified: [], totalEdits: 0, errors: ["No edit provided"] };
	}

	const result: ApplyResult = { success: true, filesModified: [], totalEdits: 0, errors: [] };
	const workspaceRoot = realpathSync(options.workspaceRoot ?? contextCwd());

	if (edit.changes) {
		for (const [uri, edits] of Object.entries(edit.changes)) {
			const validatedPath = uriToWorkspacePath(uri, workspaceRoot);
			if (!validatedPath.success) {
				result.success = false;
				result.errors.push(validatedPath.error);
				continue;
			}
			const applyResult = applyTextEditsToFile(validatedPath.path, edits);

			if (applyResult.success) {
				result.filesModified.push(validatedPath.path);
				result.totalEdits += applyResult.editCount;
			} else {
				result.success = false;
				result.errors.push(`${validatedPath.path}: ${applyResult.error}`);
			}
		}
	}

	if (edit.documentChanges) {
		for (const change of edit.documentChanges) {
			if (!("kind" in change)) {
				const validatedPath = uriToWorkspacePath(change.textDocument.uri, workspaceRoot);
				if (!validatedPath.success) {
					result.success = false;
					result.errors.push(validatedPath.error);
					continue;
				}
				const applyResult = applyTextEditsToFile(validatedPath.path, change.edits);

				if (applyResult.success) {
					result.filesModified.push(validatedPath.path);
					result.totalEdits += applyResult.editCount;
				} else {
					result.success = false;
					result.errors.push(`${validatedPath.path}: ${applyResult.error}`);
				}
				continue;
			}

			if (change.kind === "create") {
				try {
					const validatedPath = uriToWorkspacePath(change.uri, workspaceRoot);
					if (!validatedPath.success) {
						result.success = false;
						result.errors.push(`Create ${change.uri}: ${validatedPath.error}`);
						continue;
					}
					writeFileSync(validatedPath.path, "", "utf-8");
					result.filesModified.push(validatedPath.path);
				} catch (err) {
					result.success = false;
					result.errors.push(`Create ${change.uri}: ${String(err)}`);
				}
			} else if (change.kind === "rename") {
				try {
					const oldPath = uriToWorkspacePath(change.oldUri, workspaceRoot);
					const newPath = uriToWorkspacePath(change.newUri, workspaceRoot);
					if (!oldPath.success || !newPath.success) {
						const error = oldPath.success ? (newPath.success ? "invalid URI" : newPath.error) : oldPath.error;
						result.success = false;
						result.errors.push(`Rename ${change.oldUri}: ${error}`);
						continue;
					}
					const content = readFileSync(oldPath.path, "utf-8");
					writeFileSync(newPath.path, content, "utf-8");
					unlinkSync(oldPath.path);
					result.filesModified.push(newPath.path);
				} catch (err) {
					result.success = false;
					result.errors.push(`Rename ${change.oldUri}: ${String(err)}`);
				}
			} else if (change.kind === "delete") {
				try {
					const validatedPath = uriToWorkspacePath(change.uri, workspaceRoot);
					if (!validatedPath.success) {
						result.success = false;
						result.errors.push(`Delete ${change.uri}: ${validatedPath.error}`);
						continue;
					}
					unlinkSync(validatedPath.path);
					result.filesModified.push(validatedPath.path);
				} catch (err) {
					result.success = false;
					result.errors.push(`Delete ${change.uri}: ${String(err)}`);
				}
			}
		}
	}

	return result;
}
