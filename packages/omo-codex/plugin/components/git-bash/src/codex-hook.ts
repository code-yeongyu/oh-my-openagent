import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

export interface GitBashHookOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly platform?: NodeJS.Platform | string;
	readonly pluginDataRoot?: string;
}

export interface PostCompactPayload {
	readonly hook_event_name: "PostCompact";
	readonly session_id: string;
	readonly transcript_path?: string | null;
	readonly trigger?: string;
}

interface PreToolUseHookOutput {
	readonly hookSpecificOutput: {
		readonly hookEventName: "PreToolUse";
		readonly additionalContext: string;
	};
}

const BASH_TOOL_NAME = "Bash";
const REMINDER =
	"On Windows, prefer the OMO git_bash MCP for shell commands before using built-in exec_command. Use exec_command only when git_bash is unavailable or for non-shell operations.";

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

export function parsePostCompactPayload(raw: string): PostCompactPayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isPostCompactPayload(parsed) ? parsed : null;
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		return null;
	}
}

export function applyGitBashPreToolUseReminder(payload: PreToolUsePayload, options: GitBashHookOptions = {}): string {
	if (payload.hook_event_name !== "PreToolUse") return "";
	if (payload.tool_name !== BASH_TOOL_NAME) return "";
	if (!isWindowsHost(options)) return "";

	const markerPath = reminderMarkerPath(payload.session_id, options.pluginDataRoot);
	if (hasReminderMarker(markerPath)) return "";
	mkdirSync(dirname(markerPath), { recursive: true });
	writeFileSync(markerPath, `${new Date().toISOString()}\n`);

	const output: PreToolUseHookOutput = {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			additionalContext: REMINDER,
		},
	};
	return `${JSON.stringify(output)}\n`;
}

export function applyGitBashPostCompactReset(payload: PostCompactPayload, options: GitBashHookOptions = {}): string {
	if (payload.hook_event_name !== "PostCompact") return "";
	rmSync(reminderMarkerPath(payload.session_id, options.pluginDataRoot), { force: true });
	return "";
}

export async function runGitBashHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	eventName: "pre-tool-use" | "post-compact" = "pre-tool-use",
	options: GitBashHookOptions = {},
): Promise<void> {
	try {
		const raw = await readAll(stdin);
		const output =
			eventName === "post-compact" ? postCompactOutput(raw, options) : preToolUseOutput(raw, options);
		if (output.length > 0) stdout.write(output);
	} catch (error) {
		if (error instanceof Error) return;
		return;
	}
}

function preToolUseOutput(raw: string, options: GitBashHookOptions): string {
	const payload = parsePreToolUsePayload(raw);
	if (payload === null) return "";
	return applyGitBashPreToolUseReminder(payload, options);
}

function postCompactOutput(raw: string, options: GitBashHookOptions): string {
	const payload = parsePostCompactPayload(raw);
	if (payload === null) return "";
	return applyGitBashPostCompactReset(payload, options);
}

function isWindowsHost(options: GitBashHookOptions): boolean {
	const platform = options.platform ?? process.platform;
	if (platform === "win32") return true;
	const env = options.env ?? process.env;
	return env["OS"] === "Windows_NT" || env["ComSpec"] !== undefined || env["SystemRoot"] !== undefined;
}

function hasReminderMarker(path: string): boolean {
	return existsSync(path);
}

function reminderMarkerPath(sessionId: string, pluginDataRoot?: string): string {
	const root = pluginDataRoot ?? process.env["PLUGIN_DATA"] ?? join(homedir(), ".codex", "omo-git-bash");
	return join(root, "git-bash-reminder", `${safePathSegment(sessionId)}.seen`);
}

function safePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_");
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

function isPostCompactPayload(value: unknown): value is PostCompactPayload {
	if (!isRecord(value)) return false;
	return (
		value["hook_event_name"] === "PostCompact" &&
		typeof value["session_id"] === "string" &&
		(value["transcript_path"] === undefined ||
			value["transcript_path"] === null ||
			typeof value["transcript_path"] === "string") &&
		(value["trigger"] === undefined || typeof value["trigger"] === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
