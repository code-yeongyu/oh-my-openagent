import { normalizeUlwLoopSessionId } from "./paths.js";
import { SPAWN_TOOL_TOKENS } from "./spawn-guard.js";
import {
	buildRehydrateContext,
	classifySpawnResponse,
	hasActiveLoopPlan,
	recordRefused,
	recordSpawned,
} from "./spawn-ledger.js";

export interface SpawnLedgerPostToolUsePayload {
	readonly hook_event_name: "PostToolUse";
	readonly session_id: string;
	readonly cwd: string;
	readonly tool_name: string;
	readonly tool_use_id?: string;
	readonly tool_input: unknown;
	readonly tool_response: unknown;
}

export interface SpawnLedgerPostCompactPayload {
	readonly hook_event_name: "PostCompact";
	readonly session_id: string;
	readonly cwd: string;
	readonly trigger?: string;
}

export function applySpawnLedger(payload: SpawnLedgerPostToolUsePayload): string {
	if (payload.hook_event_name !== "PostToolUse") return "";
	if (!SPAWN_TOOL_TOKENS.has(payload.tool_name)) return "";
	const sessionId = normalizeUlwLoopSessionId(payload.session_id);
	if (sessionId === null || payload.cwd.trim().length === 0) return "";
	if (!hasActiveLoopPlan(payload.cwd, sessionId)) return "";
	const input = {
		sessionId,
		toolName: payload.tool_name,
		toolUseId: typeof payload.tool_use_id === "string" ? payload.tool_use_id : "",
		toolInput: payload.tool_input,
	};
	const outcome = classifySpawnResponse(payload.tool_response);
	if (outcome.kind === "ignored") return "";
	if (outcome.kind === "spawned") {
		recordSpawned(payload.cwd, sessionId, payload.tool_name, outcome, input);
		return "";
	}
	recordRefused(payload.cwd, sessionId, payload.tool_name, outcome.reason, input);
	return postToolUseContext(refusalNotice(sessionId));
}

export function applySpawnLedgerPostCompact(payload: SpawnLedgerPostCompactPayload): string {
	if (payload.hook_event_name !== "PostCompact") return "";
	const sessionId = normalizeUlwLoopSessionId(payload.session_id);
	if (sessionId === null || payload.cwd.trim().length === 0) return "";
	const context = buildRehydrateContext(payload.cwd, sessionId);
	if (context.length === 0) return "";
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostCompact",
			additionalContext: context,
		},
	})}\n`;
}

export async function runSpawnLedgerCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
	try {
		const parsed: unknown = JSON.parse(await readAll(stdin));
		if (!isPostToolUsePayload(parsed)) return;
		const output = applySpawnLedger(parsed);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

export async function runSpawnLedgerPostCompactCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
): Promise<void> {
	try {
		const parsed: unknown = JSON.parse(await readAll(stdin));
		if (!isPostCompactPayload(parsed)) return;
		const output = applySpawnLedgerPostCompact(parsed);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

function refusalNotice(sessionId: string): string {
	return [
		"SPAWN REFUSED - agent thread limit reached. The full request was durably queued at",
		`.omo/ulw-loop/${sessionId}/pending-spawns.jsonl.`,
		"Do NOT drop it: re-issue every queued spawn (same task/message) as active workers complete and slots free up.",
	].join(" ");
}

function postToolUseContext(additionalContext: string): string {
	return `${JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext,
		},
	})}\n`;
}

function isPostToolUsePayload(value: unknown): value is SpawnLedgerPostToolUsePayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "PostToolUse" &&
		typeof value["session_id"] === "string" &&
		typeof value["cwd"] === "string" &&
		typeof value["tool_name"] === "string" &&
		Object.hasOwn(value, "tool_input") &&
		Object.hasOwn(value, "tool_response")
	);
}

function isPostCompactPayload(value: unknown): value is SpawnLedgerPostCompactPayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "PostCompact" &&
		typeof value["session_id"] === "string" &&
		typeof value["cwd"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readAll(stdin: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(String(chunk)));
	return Buffer.concat(chunks).toString("utf8");
}
