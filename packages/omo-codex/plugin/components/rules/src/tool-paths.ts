import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface CodexPostToolUseLike {
	tool_name: string;
	tool_input: unknown;
	tool_response: unknown;
}

const COMMAND_TOOL_NAMES = new Set(["bash", "shell_command", "exec_command"]);
const TRACKED_TOOL_NAMES = new Set([
	"read",
	"read_file",
	"mcp__filesystem__read_file",
	"mcp__filesystem__read_multiple_files",
	"mcp__filesystem__write_file",
	"mcp__filesystem__edit_file",
	"write",
	"edit",
	"multiedit",
	"multi_edit",
	"apply_patch",
	"bash",
	"shell_command",
	"exec_command",
]);

export function extractCodexToolPaths(input: CodexPostToolUseLike, cwd: string): string[] {
	const toolName = input.tool_name.toLowerCase();
	if (!TRACKED_TOOL_NAMES.has(toolName) || isFailedToolResponse(input.tool_response)) {
		return [];
	}

	const paths = new Set<string>();
	const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
	addCommonPathFields(paths, toolInput, cwd);
	addPatchPayloadPaths(paths, toolInput, cwd);
	addPatchRecordPaths(paths, toolInput["files"], cwd);
	addPatchRecordPaths(paths, toolInput["changes"], cwd);

	if (COMMAND_TOOL_NAMES.has(toolName)) {
		const command = stringProperty(toolInput, "command") ?? stringProperty(toolInput, "cmd");
		const workdir = stringProperty(toolInput, "workdir") ?? stringProperty(toolInput, "cwd");
		addCommandPaths(paths, command, workdir === undefined ? cwd : resolvePath(cwd, workdir));
	}

	return [...paths];
}

function addCommonPathFields(paths: Set<string>, input: Record<string, unknown>, cwd: string): void {
	for (const key of ["path", "filePath", "file_path", "target", "targetPath", "target_path"]) {
		addPath(paths, input[key], cwd, false);
	}
	for (const key of ["paths", "filePaths", "file_paths"]) {
		addPathArray(paths, input[key], cwd, false);
	}
}

function addPatchPayloadPaths(paths: Set<string>, input: Record<string, unknown>, cwd: string): void {
	for (const key of ["input", "patch", "command", "cmd"]) {
		const value = input[key];
		if (typeof value === "string") {
			addPatchHeaderPaths(paths, value, cwd);
		}
	}
}

function addPatchHeaderPaths(paths: Set<string>, patch: string, cwd: string): void {
	for (const line of patch.split("\n")) {
		for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Move to: "]) {
			if (line.startsWith(prefix)) {
				addPath(paths, line.slice(prefix.length).trim(), cwd, false);
			}
		}
	}
}

function addPatchRecordPaths(paths: Set<string>, value: unknown, cwd: string): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (typeof item === "string") {
			addPath(paths, item, cwd, false);
			continue;
		}
		if (!isRecord(item)) continue;
		addCommonPathFields(paths, item, cwd);
		for (const key of ["movePath", "move_path", "to", "from"]) {
			addPath(paths, item[key], cwd, false);
		}
	}
}

function addCommandPaths(paths: Set<string>, command: string | undefined, cwd: string): void {
	if (command === undefined) return;
	for (const token of tokenizeShell(command)) {
		if (token.length === 0 || token.startsWith("-") || token.includes("*")) {
			continue;
		}
		addPath(paths, token, cwd, true);
	}
}

function addPathArray(paths: Set<string>, value: unknown, cwd: string, mustExist: boolean): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		addPath(paths, item, cwd, mustExist);
	}
}

function addPath(paths: Set<string>, value: unknown, cwd: string, mustExist: boolean): void {
	if (typeof value !== "string" || value.length === 0 || looksLikeUrl(value)) {
		return;
	}

	const path = resolvePath(cwd, value);
	if (mustExist && !isExistingFile(path)) {
		return;
	}
	paths.add(path);
}

function resolvePath(cwd: string, filePath: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function isExistingFile(filePath: string): boolean {
	try {
		return existsSync(filePath) && statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function looksLikeUrl(value: string): boolean {
	return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

function stringProperty(value: Record<string, unknown>, key: string): string | undefined {
	const property = value[key];
	return typeof property === "string" && property.length > 0 ? property : undefined;
}

function tokenizeShell(command: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (const character of command) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if ((character === "'" || character === '"') && quote === null) {
			quote = character;
			continue;
		}
		if (quote === character) {
			quote = null;
			continue;
		}
		if (quote === null && /\s/.test(character)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}

	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailedToolResponse(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error"
	);
}
