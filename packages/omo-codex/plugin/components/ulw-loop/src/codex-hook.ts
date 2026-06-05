import { readFileSync } from "node:fs";

import type { UlwLoopScope } from "./paths.js";
import { parseUlwLoopSteeringDirective, steerUlwLoop } from "./steering.js";

export interface UserPromptSubmitPayload {
	readonly cwd: string;
	readonly hook_event_name: "UserPromptSubmit";
	readonly model?: string;
	readonly permission_mode?: string;
	readonly prompt: string;
	readonly session_id: string;
	readonly transcript_path?: string;
	readonly turn_id?: string;
}

export interface PreToolUsePayload {
	readonly cwd: string;
	readonly hook_event_name: "PreToolUse";
	readonly model: string;
	readonly permission_mode: string;
	readonly session_id: string;
	readonly tool_input: unknown;
	readonly tool_name: string;
	readonly tool_use_id: string;
	readonly transcript_path: string | null;
	readonly turn_id: string;
}

interface PreToolUseHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "PreToolUse";
		readonly permissionDecision: "deny";
		readonly permissionDecisionReason: string;
		readonly additionalContext: string;
	};
}

const CREATE_GOAL_TOOL_NAME = "create_goal";
const WAIT_AGENT_TOOL_NAME = "wait_agent";
const UPDATE_GOAL_TOOL_NAME = "update_goal";
const UPDATE_PLAN_TOOL_NAME = "update_plan";
const MAX_WAIT_AGENT_TIMEOUT_MS = 30000;
const CREATE_GOAL_PAYLOAD_WARNING =
	"Use create_goal with objective only. Omit token_budget so the goal stays unlimited, and put lifecycle status changes on update_goal.";
const WAIT_AGENT_TIMEOUT_WARNING =
	"Use wait_agent with timeout_ms <= 30000 for plan/reviewer agents; long waits hide stuck children and block recovery.";
const ACTIVE_CHILD_COMPLETION_WARNING =
	"A running child agent is still active in the transcript. Do not mark dependent reviewer/subagent work or the root goal complete until the child result is integrated, recorded inconclusive, or closed and respawned.";

interface PreToolUseGuardOptions {
	readonly readTranscript?: (path: string) => string | null;
}

export function parseUserPromptSubmitPayload(raw: string): UserPromptSubmitPayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isUserPromptSubmitPayload(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

export function parsePreToolUsePayload(raw: string): PreToolUsePayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPreToolUsePayload(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

export async function applyUserPromptUlwLoopSteering(payload: UserPromptSubmitPayload): Promise<string> {
	try {
		if (payload.hook_event_name !== "UserPromptSubmit") return "";
		const proposal = parseUlwLoopSteeringDirective(payload.prompt);
		if (proposal === null) return "";
		const result = await steerUlwLoop(payload.cwd, proposal, payloadScope(payload));
		if (!result.accepted) return "";
		return JSON.stringify({
			status: "accepted",
			kind: result.audit.kind,
			source: result.audit.source,
			deduped: result.deduped,
		});
	} catch (error) {
		if (error instanceof Error) return "";
		return "";
	}
}

function payloadScope(payload: UserPromptSubmitPayload): UlwLoopScope {
	return { sessionId: payload.session_id };
}

export function applyPreToolUseGoalBudgetGuard(
	payload: PreToolUsePayload,
	options: PreToolUseGuardOptions = {},
): string {
	if (payload.hook_event_name !== "PreToolUse") return "";
	if (payload.tool_name === CREATE_GOAL_TOOL_NAME && hasInvalidCreateGoalInput(payload.tool_input)) {
		return denyPreToolUse(CREATE_GOAL_PAYLOAD_WARNING);
	}
	if (payload.tool_name === WAIT_AGENT_TOOL_NAME && hasOversizedWaitAgentInput(payload.tool_input)) {
		return denyPreToolUse(WAIT_AGENT_TIMEOUT_WARNING);
	}
	if (isUnsafeCompletionWithActiveChild(payload, options)) return denyPreToolUse(ACTIVE_CHILD_COMPLETION_WARNING);
	return "";
}

export async function runUlwLoopHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
	try {
		const payload = parseUserPromptSubmitPayload(await readAll(stdin));
		if (payload === null) return;
		const output = await applyUserPromptUlwLoopSteering(payload);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

export async function runPreToolUseGoalBudgetGuardCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
): Promise<void> {
	try {
		const payload = parsePreToolUsePayload(await readAll(stdin));
		if (payload === null) return;
		const output = applyPreToolUseGoalBudgetGuard(payload);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

function isUserPromptSubmitPayload(value: unknown): value is UserPromptSubmitPayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "UserPromptSubmit" &&
		typeof value["cwd"] === "string" &&
		typeof value["prompt"] === "string" &&
		typeof value["session_id"] === "string" &&
		["model", "permission_mode", "transcript_path", "turn_id"].every((key) => optionalString(value[key]))
	);
}

function isPreToolUsePayload(value: unknown): value is PreToolUsePayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "PreToolUse" &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["session_id"] === "string" &&
		typeof value["tool_name"] === "string" &&
		typeof value["tool_use_id"] === "string" &&
		(value["transcript_path"] === null || typeof value["transcript_path"] === "string") &&
		typeof value["turn_id"] === "string" &&
		Object.hasOwn(value, "tool_input")
	);
}

function denyPreToolUse(reason: string): string {
	const output: PreToolUseHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: reason,
			additionalContext: reason,
		},
	};
	return `${JSON.stringify(output)}\n`;
}

function hasOversizedWaitAgentInput(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const timeoutMs = value["timeout_ms"];
	return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > MAX_WAIT_AGENT_TIMEOUT_MS;
}

function isUnsafeCompletionWithActiveChild(payload: PreToolUsePayload, options: PreToolUseGuardOptions): boolean {
	if (!isDependentCompletionTransition(payload)) return false;
	return transcriptHasRunningChild(payload, options);
}

function isDependentCompletionTransition(payload: PreToolUsePayload): boolean {
	if (!isRecord(payload.tool_input)) return false;
	if (payload.tool_name === UPDATE_GOAL_TOOL_NAME) return payload.tool_input["status"] === "complete";
	if (payload.tool_name === UPDATE_PLAN_TOOL_NAME) return updatePlanCompletesDependentStep(payload.tool_input);
	return false;
}

function updatePlanCompletesDependentStep(input: Record<string, unknown>): boolean {
	const plan = input["plan"];
	if (!Array.isArray(plan)) return false;
	return plan.some((item) => isCompletedDependentPlanItem(item));
}

function isCompletedDependentPlanItem(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const step = value["step"];
	return (
		value["status"] === "completed" &&
		typeof step === "string" &&
		/(?:agent|subagent|child|review|reviewer|wait_agent)/i.test(step)
	);
}

function transcriptHasRunningChild(payload: PreToolUsePayload, options: PreToolUseGuardOptions): boolean {
	if (payload.transcript_path === null) return false;
	const transcript = readTranscript(payload.transcript_path, options);
	return transcript !== null && containsRunningChildAgent(transcript);
}

function readTranscript(path: string, options: PreToolUseGuardOptions): string | null {
	if (options.readTranscript !== undefined) return options.readTranscript(path);
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error) return null;
		return null;
	}
}

function containsRunningChildAgent(transcript: string): boolean {
	return /"agent_name"\s*:\s*"\/root\/[^"\n]+"[\s\S]{0,500}"agent_status"\s*:\s*"running"|"agent_status"\s*:\s*"running"[\s\S]{0,500}"agent_name"\s*:\s*"\/root\/[^"\n]+"/.test(
		transcript,
	);
}

function hasInvalidCreateGoalInput(value: unknown): boolean {
	return isRecord(value) && Object.keys(value).some((key) => key !== "objective");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function readAll(stdin: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (chunk: unknown) => {
			data += chunk instanceof Buffer ? chunk.toString() : String(chunk);
		});
		stdin.once("error", reject);
		stdin.once("end", () => resolve(data));
	});
}
