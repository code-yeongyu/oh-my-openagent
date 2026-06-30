#!/usr/bin/env node
import { spawn } from "node:child_process";
import { argv, execPath, stderr } from "node:process";

import { runPostCompactHookCli, runPostToolUseHookCli } from "./codex-hook-cli.js";
import { resolveLspDaemonCliPath } from "./daemon-cli-path.js";

async function main(): Promise<void> {
	const [command = "mcp", subcommand = ""] = argv.slice(2);

	if (command === "hook" && subcommand === "post-tool-use") {
		await runPostToolUseHookCli();
		return;
	}
	if (command === "hook" && subcommand === "post-compact") {
		await runPostCompactHookCli();
		return;
	}

	if (command === "mcp") {
		await runPackageLspMcpCli();
		return;
	}

	stderr.write("Usage: omo-lsp [mcp | hook post-tool-use | hook post-compact]\n");
	process.exitCode = 2;
}

main().catch((error: unknown) => {
	stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});

async function runPackageLspMcpCli(): Promise<void> {
	const cliPath = resolveLspDaemonCliPath();
	const child = spawn(execPath, [cliPath, "mcp"], { stdio: "inherit" });
	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code !== null && code !== 0) process.exitCode = code;
			if (code === null && signal !== null) process.exitCode = 1;
			resolve();
		});
	});
}
