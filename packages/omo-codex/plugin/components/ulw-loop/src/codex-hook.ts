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
const CREATE_GOAL_PAYLOAD_WARNING =
	"Use create_goal with objective only. Omit token_budget so the goal stays unlimited, and put lifecycle status changes on update_goal.";

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

export function applyPreToolUseGoalBudgetGuard(payload: PreToolUsePayload): string {
	if (payload.hook_event_name !== "PreToolUse") return "";
	if (payload.tool_name !== CREATE_GOAL_TOOL_NAME) return "";
	if (!hasInvalidCreateGoalInput(payload.tool_input)) return "";
	const output: PreToolUseHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: CREATE_GOAL_PAYLOAD_WARNING,
			additionalContext: CREATE_GOAL_PAYLOAD_WARNING,
		},
	};
	return `${JSON.stringify(output)}\n`;
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
