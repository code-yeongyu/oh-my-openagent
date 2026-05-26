#!/usr/bin/env node
import { stdin as processStdin, stdout as processStdout } from "node:process";

import { type CodexSessionStartInput, runSessionStartHook } from "./codex-hook.js";

const command = process.argv[2];
const subcommand = process.argv[3];

if (command === "hook" && subcommand === "session-start") {
	await runHookCli();
} else {
	process.stderr.write("Usage: codex-telemetry hook session-start\n");
	process.exitCode = 1;
}

async function runHookCli(): Promise<void> {
	const raw = await readStdin();
	if (raw.trim().length === 0) return;
	const parsed = parseHookInput(raw);
	if (!isCodexSessionStartInput(parsed)) return;
	const output = await runSessionStartHook(parsed);
	if (output.length > 0) {
		processStdout.write(output);
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
			resolve(data);
		});
	});
}
