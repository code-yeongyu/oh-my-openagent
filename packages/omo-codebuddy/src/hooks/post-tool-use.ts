import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
	type CheckResult,
	type HookInput,
	resolveCommentCheckerBinary,
	runCommentChecker,
	type SpawnProcess,
	type SpawnSignal,
} from "@oh-my-opencode/comment-checker-core";

import { additionalContextOutput } from "../protocol/index.ts";
import { resolvePluginRoot } from "./paths.ts";

/**
 * PostToolUse → comment checker.
 *
 * CodeBuddy's PostToolUse payload already matches the shape the shared
 * `comment-checker-core` consumes (`tool_name` / `tool_input` /
 * `tool_response`); this module only translates the harness tool aliases and
 * adapts Bun's spawn surface to the core's injectable one.
 *
 * The checker binary is optional: when it is not installed the hook stays
 * silent instead of degrading the edit flow.
 */
export const EDIT_TOOL_ALIASES: Record<string, "write" | "edit" | "multiedit"> = {
	Write: "write",
	write_to_file: "write",
	Edit: "edit",
	replace_in_file: "edit",
	MultiEdit: "multiedit",
	multi_edit: "multiedit",
	multiedit: "multiedit",
};

export interface PostToolUseOptions {
	readonly env?: Record<string, string | undefined>;
	readonly runChecker?: typeof runCommentChecker;
	readonly resolveBinary?: () => string | null;
}

export async function runPostToolUseHook(
	payload: Record<string, unknown>,
	options: PostToolUseOptions = {},
): Promise<string> {
	if (payload["hook_event_name"] !== "PostToolUse") return "";

	const rawToolName = typeof payload["tool_name"] === "string" ? payload["tool_name"] : "";
	const normalizedToolName = EDIT_TOOL_ALIASES[rawToolName];
	if (normalizedToolName === undefined) return "";

	const toolInput = isRecord(payload["tool_input"]) ? payload["tool_input"] : {};
	const normalizedInput = normalizeToolInput(toolInput);
	if (normalizedInput.file_path === undefined) return "";

	const hookInput: HookInput = {
		session_id: typeof payload["session_id"] === "string" ? payload["session_id"] : "",
		tool_name: normalizedToolName,
		transcript_path: typeof payload["transcript_path"] === "string" ? payload["transcript_path"] : "",
		cwd: typeof payload["cwd"] === "string" ? payload["cwd"] : process.cwd(),
		hook_event_name: "PostToolUse",
		tool_input: normalizedInput,
		tool_response: payload["tool_response"],
	};

	const binaryPath = (options.resolveBinary ?? (() => resolveCommentCheckerBinaryPath(options.env)))();
	if (binaryPath === null) return "";

	const checker = options.runChecker ?? runCommentChecker;
	let result: CheckResult;
	try {
		result = await checker({ hookInput, binaryPath }, { spawn: spawnProcess, existsSync });
	} catch {
		return "";
	}
	if (!result.hasComments || result.message.trim().length === 0) return "";

	return additionalContextOutput(
		"PostToolUse",
		[
			"comment-checker flagged the change you just made. Fix the comments before moving on:",
			"",
			result.message.replace(/\r\n/g, "\n").trim(),
			"",
			"Keep comments that explain non-obvious WHY; delete narration of what the code already says.",
		].join("\n"),
	);
}

export function resolveCommentCheckerBinaryPath(env?: Record<string, string | undefined>): string | null {
	const resolvedEnv = env ?? process.env;
	const explicit = resolvedEnv["OMO_COMMENT_CHECKER_BINARY"];
	if (explicit !== undefined && explicit.trim().length > 0 && existsSync(explicit)) return explicit;

	const dataDir = resolvedEnv["CODEBUDDY_PLUGIN_DATA"] ?? resolvedEnv["CLAUDE_PLUGIN_DATA"];
	if (dataDir !== undefined && dataDir.trim().length > 0) {
		const fromData = join(dataDir, "bin", "comment-checker");
		if (existsSync(fromData)) return fromData;
	}

	return resolveCommentCheckerBinary({
		binaryName: "comment-checker",
		cachedBinaryPath: null,
		existsSync,
		importMetaUrl: import.meta.url,
		...(resolvedEnv["OMO_COMMENT_CHECKER_PACKAGE"] === undefined
			? {}
			: { packageName: resolvedEnv["OMO_COMMENT_CHECKER_PACKAGE"] as string }),
	});
}

export function normalizeToolInput(toolInput: Record<string, unknown>): HookInput["tool_input"] {
	const filePath = firstString(toolInput, ["file_path", "filePath", "path", "target_file"]);
	const content = firstString(toolInput, ["content", "contents", "text"]);
	const oldString = firstString(toolInput, ["old_string", "oldString", "old_str", "oldText"]);
	const newString = firstString(toolInput, ["new_string", "newString", "new_str", "newText"]);
	const edits = normalizeEdits(toolInput["edits"]);

	return {
		...(filePath === undefined ? {} : { file_path: filePath }),
		...(content === undefined ? {} : { content }),
		...(oldString === undefined ? {} : { old_string: oldString }),
		...(newString === undefined ? {} : { new_string: newString }),
		...(edits === undefined ? {} : { edits }),
	};
}

function normalizeEdits(value: unknown): readonly { old_string: string; new_string: string }[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const edits: { old_string: string; new_string: string }[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) continue;
		const oldString = firstString(entry, ["old_string", "oldString", "old_str"]);
		const newString = firstString(entry, ["new_string", "newString", "new_str"]);
		if (oldString === undefined || newString === undefined) continue;
		edits.push({ old_string: oldString, new_string: newString });
	}
	return edits.length === 0 ? undefined : edits;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** Bridges Bun's child_process to the core's structural `SpawnProcess` type. */
export function spawnProcess(args: readonly string[]): SpawnProcess {
	const [command, ...rest] = args;
	if (command === undefined) throw new Error("comment-checker spawn requires a command");
	const child = spawn(command, [...rest], { stdio: ["pipe", "pipe", "pipe"] });
	return {
		stdin: {
			write(input: string): void {
				child.stdin?.write(input);
			},
			end(): void {
				child.stdin?.end();
			},
		},
		stdout: toWebStream(child.stdout),
		stderr: toWebStream(child.stderr),
		exited: new Promise<number>((resolve) => {
			child.once("exit", (code) => resolve(code ?? 0));
			child.once("error", () => resolve(0));
		}),
		kill(signal: SpawnSignal): void {
			child.kill(signal);
		},
	};
}

function toWebStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> {
	if (stream === null) return new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
	return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
