import { stdin as processStdin } from "node:process";

import { executeLspDiagnostics } from "@code-yeongyu/lsp-tools-mcp/dist/tools.js";

export type DiagnosticsRunner = (filePath: string) => Promise<string>;

export interface CodexPostToolUseInput {
	tool_name?: unknown;
	tool_input?: unknown;
	tool_response?: unknown;
}

interface DiagnosticBlock {
	filePath: string;
	diagnostics: string;
}

interface PostToolUseHookOutput {
	decision: "block";
	reason: string;
	hookSpecificOutput: {
		hookEventName: "PostToolUse";
		additionalContext: string;
	};
}

const MUTATION_TOOL_NAMES = new Set(["apply_patch", "write", "edit", "multiedit", "multi_edit"]);
const CLEAN_DIAGNOSTICS_TEXT = "No diagnostics found";
const UNSUPPORTED_EXTENSION_TEXT = "No LSP server configured for extension:";

export async function runLspDiagnosticsText(filePath: string): Promise<string> {
	const result = await executeLspDiagnostics({ filePath, severity: "error" });
	return result.content.map((block) => block.text).join("\n");
}

export async function runLspPostToolUseHook(
	input: CodexPostToolUseInput,
	runDiagnostics: DiagnosticsRunner = runLspDiagnosticsText,
): Promise<string> {
	const filePaths = extractMutatedFilePaths(input);
	if (filePaths.length === 0) return "";

	const blocks: DiagnosticBlock[] = [];
	for (const filePath of filePaths) {
		const diagnostics = (await runDiagnostics(filePath)).trim();
		if (isCleanDiagnostics(diagnostics)) continue;
		blocks.push({ filePath, diagnostics });
	}

	if (blocks.length === 0) return "";

	const reason = blocks
		.map(({ filePath, diagnostics }) => `LSP diagnostics after editing ${filePath}:\n${diagnostics}`)
		.join("\n\n");
	const output: PostToolUseHookOutput = {
		decision: "block",
		reason,
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: reason,
		},
	};
	return `${JSON.stringify(output)}\n`;
}

export function extractMutatedFilePaths(input: CodexPostToolUseInput): string[] {
	if (!isMutationTool(input.tool_name)) return [];
	if (isFailedToolResponse(input.tool_response)) return [];

	const toolInput = isRecord(input.tool_input) ? input.tool_input : {};
	const paths = new Set<string>();
	addStringValue(paths, toolInput["path"]);
	addStringValue(paths, toolInput["filePath"]);
	addStringValue(paths, toolInput["file_path"]);
	addStringArray(paths, toolInput["paths"]);
	addStringArray(paths, toolInput["filePaths"]);
	addStringArray(paths, toolInput["file_paths"]);
	addPatchPayloads(paths, toolInput);
	addPatchFiles(paths, toolInput["files"]);
	addPatchFiles(paths, toolInput["changes"]);
	return [...paths];
}

export async function runPostToolUseHookCli(stdin: NodeJS.ReadStream = processStdin): Promise<void> {
	const raw = await readStdin(stdin);
	if (!raw.trim()) return;
	const parsed: unknown = JSON.parse(raw);
	const input = isRecord(parsed) ? parsed : {};
	const output = await runLspPostToolUseHook(input);
	if (output) process.stdout.write(output);
}

function isMutationTool(value: unknown): boolean {
	if (typeof value !== "string") return false;
	return MUTATION_TOOL_NAMES.has(value.toLowerCase());
}

function isCleanDiagnostics(diagnostics: string): boolean {
	return (
		diagnostics.length === 0 ||
		diagnostics === CLEAN_DIAGNOSTICS_TEXT ||
		diagnostics.startsWith(UNSUPPORTED_EXTENSION_TEXT)
	);
}

function isFailedToolResponse(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error"
	);
}

function addStringValue(paths: Set<string>, value: unknown): void {
	if (typeof value === "string" && value.length > 0) {
		paths.add(value);
	}
}

function addStringArray(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		addStringValue(paths, item);
	}
}

function addPatchPayloads(paths: Set<string>, input: Record<string, unknown>): void {
	addPatchInput(paths, input["input"]);
	addPatchInput(paths, input["patch"]);
	addPatchInput(paths, input["command"]);
}

function addPatchInput(paths: Set<string>, value: unknown): void {
	if (typeof value !== "string") return;
	for (const line of value.split("\n")) {
		const path = extractPatchHeaderPath(line);
		if (path !== undefined) paths.add(path);
	}
}

function extractPatchHeaderPath(line: string): string | undefined {
	const prefixes = ["*** Add File: ", "*** Update File: ", "*** Move to: "] as const;
	for (const prefix of prefixes) {
		if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
	}
	return undefined;
}

function addPatchFiles(paths: Set<string>, value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const item of value) {
		if (!isRecord(item)) continue;
		addStringValue(paths, item["path"]);
		addStringValue(paths, item["filePath"]);
		addStringValue(paths, item["file_path"]);
		addStringValue(paths, item["movePath"]);
		addStringValue(paths, item["move_path"]);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStdin(stdin: NodeJS.ReadStream): Promise<string> {
	stdin.setEncoding("utf8");
	let raw = "";
	for await (const chunk of stdin) {
		raw += chunk;
	}
	return raw;
}
