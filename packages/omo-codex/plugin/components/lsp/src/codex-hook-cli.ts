import { stdin as processStdin } from "node:process";

import { disposeDefaultLspManager } from "@code-yeongyu/lsp-daemon";

import { isRecord, runLspPostCompactHook, runLspPostToolUseHook } from "./codex-hook.js";

export async function runPostToolUseHookCli(stdin: NodeJS.ReadStream = processStdin): Promise<void> {
	await runHookCli((input) => runLspPostToolUseHook(input), stdin);
}

export async function runPostCompactHookCli(stdin: NodeJS.ReadStream = processStdin): Promise<void> {
	await runHookCli((input) => runLspPostCompactHook(input), stdin);
}

async function runHookCli(
	runHook: (input: Record<string, unknown>) => Promise<string>,
	stdin: NodeJS.ReadStream,
): Promise<void> {
	try {
		const raw = await readStdin(stdin);
		if (!raw.trim()) return;
		const parsed: unknown = JSON.parse(raw);
		const input = isRecord(parsed) ? parsed : {};
		const output = await runHook(input);
		if (output) process.stdout.write(output);
	} catch {
		// LSP feedback is best-effort: stderr or a non-zero exit here surfaces as harness noise on every edit.
		return;
	} finally {
		await disposeDefaultLspManager().catch(() => undefined);
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
