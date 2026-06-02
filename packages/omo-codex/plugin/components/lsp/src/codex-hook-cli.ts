import { stdin as processStdin } from "node:process";

import { disposeDefaultLspManager } from "@code-yeongyu/lsp-tools-mcp/dist/lsp/manager.js";

import { isRecord, runLspPostToolUseHook } from "./codex-hook.js";

export async function runPostToolUseHookCli(stdin: NodeJS.ReadStream = processStdin): Promise<void> {
	try {
		const raw = await readStdin(stdin);
		if (!raw.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			if (error instanceof SyntaxError) return;
			throw error;
		}
		const input = isRecord(parsed) ? parsed : {};
		const output = await runLspPostToolUseHook(input);
		if (output) process.stdout.write(output);
	} finally {
		await disposeDefaultLspManager();
	}
}

async function readStdin(stdin: NodeJS.ReadStream): Promise<string> {
	stdin.setEncoding("utf8");
	let raw = "";
	for await (const chunk of stdin) {
		raw += chunk;
	}
	return raw;
}
