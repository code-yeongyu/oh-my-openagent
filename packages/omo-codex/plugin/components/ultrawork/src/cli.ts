#!/usr/bin/env node
import { stdin as processStdin, stdout as processStdout } from "node:process";

import { runUserPromptSubmitHook } from "./codex-hook.js";

const command = process.argv[2];
const subcommand = process.argv[3];

if (command === "hook" && subcommand === "user-prompt-submit") {
	await runHookCli();
} else {
	process.stderr.write("Usage: omo-ultrawork hook user-prompt-submit\n");
	process.exitCode = 1;
}

async function runHookCli(): Promise<void> {
	const raw = await readStdin();
	if (raw.trim().length === 0) return;
	const parsed = parseHookInput(raw);
	const output = runUserPromptSubmitHook(parsed);
	if (output.length > 0) {
		processStdout.write(output);
	}
}

function parseHookInput(raw: string): unknown | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		processStdin.setEncoding("utf8");
		processStdin.on("data", (chunk: string) => {
			data += chunk;
		});
		processStdin.once("error", () => {
			resolve(data);
		});
		processStdin.once("end", () => {
			resolve(data);
		});
	});
}
