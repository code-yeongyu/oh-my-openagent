import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ulwLoopDir } from "./paths.js";

export const SPAWN_LEDGER_FILE = "spawn-ledger.jsonl";
export const PENDING_SPAWNS_FILE = "pending-spawns.jsonl";

// Codex refuses spawns past the session's agent thread cap with "agent thread
// limit reached" (v1 agents.max_threads); the v2 runner surfaces the same
// condition as AgentLimitReached / "too many agents".
export const SPAWN_REFUSAL_PATTERN = /(?:agent|thread) limit reached|agentlimitreached|too many agents/i;

// Top-level response keys that carry a durable worker identity, in priority
// order (v1 agent ids, v2 flat agent paths/task names). A bare "id" key is
// deliberately NOT accepted: error payloads can echo unrelated request ids,
// which would misclassify a refusal as a successful spawn. Nested identity
// objects are equally out of scope: neither spawn surface nests.
const WORKER_ID_KEYS = [
	"agentId",
	"agent_id",
	"agentPath",
	"agent_path",
	"taskName",
	"task_name",
	"threadId",
	"thread_id",
] as const;

const MESSAGE_HEAD_CHARS = 160;
const REASON_CHARS = 200;

export type SpawnOutcome =
	| { readonly kind: "ignored" }
	| { readonly kind: "spawned"; readonly workerId: string }
	| { readonly kind: "refused"; readonly reason: string };

export interface SpawnLedgerEntryInput {
	readonly sessionId: string;
	readonly toolName: string;
	readonly toolUseId: string;
	readonly toolInput: unknown;
}

export function classifySpawnResponse(toolResponse: unknown): SpawnOutcome {
	const record = parseResponseRecord(toolResponse);
	const workerId = extractWorkerId(record);
	if (workerId !== null) return { kind: "spawned", workerId };
	const serialized = serializeResponse(toolResponse);
	if (SPAWN_REFUSAL_PATTERN.test(serialized)) return { kind: "refused", reason: refusalReason(serialized) };
	return { kind: "ignored" };
}

export function recordSpawned(
	cwd: string,
	sessionId: string,
	toolName: string,
	outcome: Extract<SpawnOutcome, { kind: "spawned" }>,
	input: SpawnLedgerEntryInput,
): void {
	appendLine(ulwLoopDir(cwd, { sessionId }), SPAWN_LEDGER_FILE, {
		ts: new Date().toISOString(),
		event: "spawned",
		sessionId,
		toolName,
		toolUseId: input.toolUseId,
		workerId: outcome.workerId,
		agentType: inputStringField(input.toolInput, "agent_type"),
		taskName: inputStringField(input.toolInput, "task_name"),
		messageHead: inputStringField(input.toolInput, "message").trim().slice(0, MESSAGE_HEAD_CHARS),
	});
}

export function recordRefused(
	cwd: string,
	sessionId: string,
	toolName: string,
	reason: string,
	input: SpawnLedgerEntryInput,
): void {
	appendLine(ulwLoopDir(cwd, { sessionId }), PENDING_SPAWNS_FILE, {
		ts: new Date().toISOString(),
		event: "refused",
		sessionId,
		toolName,
		toolUseId: input.toolUseId,
		reason,
		toolInput: input.toolInput,
	});
}

export function hasActiveLoopPlan(cwd: string, sessionId: string): boolean {
	try {
		const raw = readFileSync(join(ulwLoopDir(cwd, { sessionId }), "goals.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

// Post-compaction truth: rebuilt exclusively from the durable JSONL files, so a
// lossy conversation summary can never erase spawned workers or queued refusals.
export function buildRehydrateContext(cwd: string, sessionId: string): string {
	const stateDir = ulwLoopDir(cwd, { sessionId });
	const parts: string[] = [];
	const spawnedIds = readJsonLines(join(stateDir, SPAWN_LEDGER_FILE))
		.map((line) => line["workerId"])
		.filter((workerId): workerId is string => typeof workerId === "string");
	if (spawnedIds.length > 0) {
		parts.push(`${spawnedIds.length} worker(s) already spawned this session [${spawnedIds.join(", ")}]`);
	}
	const pendingCount = readJsonLines(join(stateDir, PENDING_SPAWNS_FILE)).length;
	if (pendingCount > 0) {
		parts.push(
			`${pendingCount} spawn(s) were refused by the agent thread limit and remain queued at .omo/ulw-loop/${sessionId}/${PENDING_SPAWNS_FILE} - re-issue any you have not already re-issued`,
		);
	}
	if (parts.length === 0) return "";
	return `Durable swarm state read from disk (survives compaction): ${parts.join("; ")}.`;
}

function appendLine(stateDir: string, fileName: string, entry: Record<string, unknown>): void {
	mkdirSync(stateDir, { recursive: true });
	appendFileSync(join(stateDir, fileName), `${JSON.stringify(entry)}\n`);
}

function readJsonLines(path: string): Array<Record<string, unknown>> {
	try {
		if (!existsSync(path)) return [];
		return readFileSync(path, "utf8")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	} catch (error) {
		if (error instanceof Error) return [];
		throw error;
	}
}

function parseResponseRecord(toolResponse: unknown): Record<string, unknown> | null {
	if (isRecord(toolResponse)) return toolResponse;
	if (typeof toolResponse !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(toolResponse);
		return isRecord(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

function extractWorkerId(record: Record<string, unknown> | null): string | null {
	if (record === null) return null;
	for (const key of WORKER_ID_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return null;
}

function serializeResponse(toolResponse: unknown): string {
	if (typeof toolResponse === "string") return toolResponse;
	try {
		return JSON.stringify(toolResponse) ?? "";
	} catch (error) {
		if (error instanceof Error) return "";
		throw error;
	}
}

function refusalReason(serialized: string): string {
	const matchingLine = serialized.split(/\r?\n/).find((line) => SPAWN_REFUSAL_PATTERN.test(line));
	const reason = matchingLine ?? serialized;
	return reason.trim().slice(0, REASON_CHARS);
}

function inputStringField(source: unknown, key: string): string {
	if (!isRecord(source)) return "";
	const value = source[key];
	return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
