#!/usr/bin/env node
import { stdin as processStdin, stdout as processStdout } from "node:process";

import {
	type CodexPostCompactInput,
	type CodexPostToolUseInput,
	type CodexRulesHookOptions,
	type CodexSessionStartInput,
	type CodexUserPromptSubmitInput,
	runPostCompactHook,
	runPostToolUseHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "./codex-hook.js";

const command = process.argv[2];
const subcommand = process.argv[3];
type HookCliEventName = "SessionStart" | "UserPromptSubmit" | "PostToolUse" | "PostCompact";

if (command === "hook" && subcommand === "session-start") {
	await runHookCli("SessionStart");
} else if (command === "hook" && subcommand === "user-prompt-submit") {
	await runHookCli("UserPromptSubmit");
} else if (command === "hook" && subcommand === "post-tool-use") {
	await runHookCli("PostToolUse");
} else if (command === "hook" && subcommand === "post-compact") {
	await runHookCli("PostCompact");
} else {
	process.stderr.write("Usage: omo-rules hook [session-start|user-prompt-submit|post-tool-use|post-compact]\n");
	process.exitCode = 1;
}

async function runHookCli(eventName: HookCliEventName): Promise<void> {
	const raw = await readStdin();
	if (raw.trim().length === 0) return;
	const parsed = parseHookInput(raw);
	if (!parsed) return;
	const pluginDataRoot = process.env["PLUGIN_DATA"];
	const options: CodexRulesHookOptions = pluginDataRoot === undefined ? {} : { pluginDataRoot };
	const output = await runHook(eventName, parsed, options);
	await writeStdout(output);
}

async function runHook(eventName: HookCliEventName, parsed: unknown, options: CodexRulesHookOptions): Promise<string> {
	switch (eventName) {
		case "SessionStart":
			return isCodexSessionStartInput(parsed) ? await runSessionStartHook(parsed, options) : "";
		case "UserPromptSubmit":
			return isCodexUserPromptSubmitInput(parsed) ? await runUserPromptSubmitHook(parsed, options) : "";
		case "PostToolUse":
			return isCodexPostToolUseInput(parsed) ? await runPostToolUseHook(parsed, options) : "";
		case "PostCompact":
			return isCodexPostCompactInput(parsed) ? await runPostCompactHook(parsed, options) : "";
	}
}

function parseHookInput(raw: string): unknown | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed;
	} catch {
		return undefined;
	}
}

function isCodexSessionStartInput(value: unknown): value is CodexSessionStartInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === "SessionStart" &&
		typeof value["session_id"] === "string" &&
		isStringOrNull(value["transcript_path"]) &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["source"] === "string"
	);
}

function isCodexUserPromptSubmitInput(value: unknown): value is CodexUserPromptSubmitInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === "UserPromptSubmit" &&
		typeof value["session_id"] === "string" &&
		typeof value["turn_id"] === "string" &&
		isStringOrNull(value["transcript_path"]) &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["prompt"] === "string"
	);
}

function isCodexPostToolUseInput(value: unknown): value is CodexPostToolUseInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === "PostToolUse" &&
		typeof value["session_id"] === "string" &&
		typeof value["turn_id"] === "string" &&
		isStringOrNull(value["transcript_path"]) &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		typeof value["permission_mode"] === "string" &&
		typeof value["tool_name"] === "string" &&
		typeof value["tool_use_id"] === "string"
	);
}

function isCodexPostCompactInput(value: unknown): value is CodexPostCompactInput {
	return (
		isRecord(value) &&
		value["hook_event_name"] === "PostCompact" &&
		typeof value["session_id"] === "string" &&
		typeof value["turn_id"] === "string" &&
		isStringOrNull(value["transcript_path"]) &&
		typeof value["cwd"] === "string" &&
		typeof value["model"] === "string" &&
		(value["trigger"] === "manual" || value["trigger"] === "auto")
	);
}

function isStringOrNull(value: unknown): value is string | null {
	return typeof value === "string" || value === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		processStdin.setEncoding("utf8");
		processStdin.on("data", (chunk: string) => {
			data += chunk;
		});
		processStdin.once("error", reject);
		processStdin.once("end", () => {
			processStdin.pause();
			resolve(data);
		});
		processStdin.resume();
	});
}

function writeStdout(output: string): Promise<void> {
	if (output.length === 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		processStdout.write(output, (error: Error | null | undefined) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
