import { readFileSync } from "node:fs";

import { executeLspDiagnostics } from "@code-yeongyu/lsp-tools-mcp/dist/tools.js";

export type DiagnosticsRunner = (filePath: string) => Promise<string>;

export interface CodexPostToolUseInput {
	tool_name?: unknown;
	tool_input?: unknown;
	tool_response?: unknown;
	transcript_path?: unknown;
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
const DIAGNOSTIC_START_PATTERN = /(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/g;
const DIAGNOSTIC_CHUNK_PATTERN = /^(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/;
const DEFAULT_MAX_HOOK_FEEDBACK_CHARS = 8000;
const CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS = 1200;
const MAX_CONCURRENT_DIAGNOSTICS = 4;
const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

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
	for (const { filePath, diagnostics } of await collectDiagnostics(filePaths, runDiagnostics)) {
		if (isCleanDiagnostics(diagnostics)) continue;
		blocks.push({ filePath, diagnostics });
	}

	if (blocks.length === 0) return "";

	const rawReason = blocks.map(formatDiagnosticBlock).join("\n\n");
	const reason = limitHookText(rawReason, hookFeedbackLimit(input.transcript_path));
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

async function collectDiagnostics(
	filePaths: readonly string[],
	runDiagnostics: DiagnosticsRunner,
): Promise<DiagnosticBlock[]> {
	const results: DiagnosticBlock[] = [];
	let nextIndex = 0;
	const workerCount = Math.min(MAX_CONCURRENT_DIAGNOSTICS, filePaths.length);
	async function worker(): Promise<void> {
		for (;;) {
			const index = nextIndex;
			nextIndex += 1;
			const filePath = filePaths[index];
			if (filePath === undefined) return;
			results[index] = { filePath, diagnostics: await collectFileDiagnostics(filePath, runDiagnostics) };
		}
	}
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

async function collectFileDiagnostics(filePath: string, runDiagnostics: DiagnosticsRunner): Promise<string> {
	try {
		return (await runDiagnostics(filePath)).trim();
	} catch (error) {
		return formatDiagnosticsError(error);
	}
}

function formatDiagnosticsError(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) return message;
	}
	return String(error).trim();
}

function formatDiagnosticBlock({ filePath, diagnostics }: DiagnosticBlock): string {
	return `LSP diagnostics after editing ${filePath}:\n\n${formatDiagnosticsForDisplay(diagnostics)}`;
}

function formatDiagnosticsForDisplay(diagnostics: string): string {
	const chunks = splitDiagnosticChunks(diagnostics);
	if (!chunks.some(isDiagnosticChunk)) return chunks.join("\n").trim();
	return chunks.map(formatDiagnosticChunk).join("\n");
}

function splitDiagnosticChunks(diagnostics: string): string[] {
	const normalized = diagnostics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
	if (normalized.length === 0) return [];

	const matches = Array.from(normalized.matchAll(DIAGNOSTIC_START_PATTERN));
	const firstMatch = matches[0];
	if (firstMatch?.index === undefined) return [normalized];

	const chunks: string[] = [];
	const leadingText = normalized.slice(0, firstMatch.index).trim();
	if (leadingText.length > 0) chunks.push(leadingText);

	for (const [index, match] of matches.entries()) {
		if (match.index === undefined) continue;
		const nextMatch = matches[index + 1];
		const end = nextMatch?.index ?? normalized.length;
		const chunk = normalized.slice(match.index, end).trim();
		if (chunk.length > 0) chunks.push(chunk);
	}

	return chunks;
}

function formatDiagnosticChunk(chunk: string): string {
	const lines = chunk.split("\n");
	const firstLine = lines[0];
	if (firstLine === undefined) return "";
	if (!isDiagnosticChunk(firstLine)) return chunk;
	const followingLines = lines.slice(1).map((line) => `  ${line}`);
	return [`- ${firstLine}`, ...followingLines].join("\n");
}

function isDiagnosticChunk(chunk: string): boolean {
	return DIAGNOSTIC_CHUNK_PATTERN.test(chunk);
}

function hookFeedbackLimit(transcriptPath: unknown): number {
	return isContextPressureTranscript(transcriptPath)
		? CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS
		: DEFAULT_MAX_HOOK_FEEDBACK_CHARS;
}

function isContextPressureTranscript(transcriptPath: unknown): boolean {
	if (typeof transcriptPath !== "string") return false;
	try {
		return hasContextPressureMarker(readFileSync(transcriptPath, "utf8"));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function hasContextPressureMarker(text: string): boolean {
	const normalizedText = text.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}

function limitHookText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const marker = `\n\n[Truncated hook output to ${maxChars} chars to avoid Codex context overflow.]`;
	if (marker.length >= maxChars) return marker.slice(0, maxChars);
	const head = text.slice(0, maxChars - marker.length).replace(/[ \t\r\n]+$/, "");
	return `${head}${marker}`;
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

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
