import { lstatSync as nodeLstatSync, realpathSync as nodeRealpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { renderDirective } from "./directive.js";
import { clearAttemptState, MAX_ATTEMPTS, readAttemptState, writeAttemptState } from "./state.js";
import type { HookFileSystem, StopHookOutput, SubagentStopInput } from "./types.js";
import { SUBAGENT_STOP_EVENT } from "./types.js";

const RECEIPT_ENFORCED_AGENTS = new Set([
	"lazycodex-worker-low",
	"lazycodex-worker-medium",
	"lazycodex-worker-high",
]);

export function runSubagentStopHook(input: unknown, fs: HookFileSystem): string {
	if (!isSubagentStopInput(input)) return "";
	if (!RECEIPT_ENFORCED_AGENTS.has(input.agent_type)) return "";
	if (transcriptHasContextPressureMarker(input.transcript_path, fs)) return "";
	if (hasValidEvidenceReceipt(input, fs)) {
		clearAttemptState(input.cwd, input.session_id, input.agent_id, fs);
		return "";
	}
	const state = readAttemptState(input.cwd, input.session_id, input.agent_id, fs);
	if (state.attempts >= MAX_ATTEMPTS) {
		clearAttemptState(input.cwd, input.session_id, input.agent_id, fs);
		return "";
	}
	const attempts = state.attempts + 1;
	writeAttemptState(input.cwd, input.session_id, input.agent_id, { attempts }, fs);
	return JSON.stringify({
		decision: "block",
		reason: renderDirective(attempts, input.last_assistant_message),
	} satisfies StopHookOutput);
}

const CONTEXT_PRESSURE_MARKERS = [
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const;

function transcriptHasContextPressureMarker(transcriptPath: string, fs: HookFileSystem): boolean {
	try {
		const transcript = fs.readFileSync(transcriptPath, "utf8").toLowerCase();
		return CONTEXT_PRESSURE_MARKERS.some((marker) => transcript.includes(marker));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function hasValidEvidenceReceipt(input: SubagentStopInput, fs: HookFileSystem): boolean {
	const receiptPath = extractEvidencePath(input.last_assistant_message);
	if (receiptPath === null) return false;
	const evidenceRoot = resolve(input.cwd, ".omo", "evidence");
	const resolvedPath = isAbsolute(receiptPath) ? resolve(receiptPath) : resolve(input.cwd, receiptPath);
	if (!isPathInsideDirectory(resolvedPath, evidenceRoot)) return false;
	try {
		return isNonEmptyFileInsideEvidenceRoot(resolvedPath, evidenceRoot, input.cwd, fs);
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
	const relativePath = relative(directoryPath, filePath);
	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isNonEmptyFileInsideEvidenceRoot(
	filePath: string,
	evidenceRoot: string,
	cwd: string,
	fs: HookFileSystem,
): boolean {
	if (!fs.existsSync(filePath)) return false;
	const realCwd = realPath(cwd, fs);
	const realEvidenceRoot = realPath(evidenceRoot, fs);
	const realFilePath = realPath(filePath, fs);
	if (!isPathInsideDirectory(realEvidenceRoot, realCwd)) return false;
	if (!isPathInsideDirectory(realFilePath, realEvidenceRoot)) return false;
	return isNonEmptyFile(filePath, fs);
}

function isNonEmptyFile(filePath: string, fs: HookFileSystem): boolean {
	if (!fs.existsSync(filePath)) return false;
	const linkStat = fs.lstatSync?.(filePath) ?? nodeLstatSync(filePath);
	if (linkStat.isSymbolicLink?.() === true) return false;
	const stat = fs.statSync(filePath);
	if (stat.size <= 0) return false;
	return stat.isFile?.() ?? true;
}

function realPath(path: string, fs: HookFileSystem): string {
	return fs.realpathSync?.(path) ?? nodeRealpathSync(path);
}

function extractEvidencePath(message: string | undefined): string | null {
	if (message === undefined) return null;
	const match = /EVIDENCE_RECORDED:\s*(\S+)/.exec(message);
	const receiptPath = match?.[1];
	return receiptPath === undefined ? null : receiptPath;
}

function isSubagentStopInput(value: unknown): value is SubagentStopInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === SUBAGENT_STOP_EVENT &&
		typeof value["agent_type"] === "string" &&
		typeof value["agent_id"] === "string" &&
		typeof value["session_id"] === "string" &&
		typeof value["cwd"] === "string" &&
		typeof value["transcript_path"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["stop_hook_active"] === "boolean" &&
		optionalString(value["turn_id"]) &&
		optionalString(value["last_assistant_message"])
	);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
