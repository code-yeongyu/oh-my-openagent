#!/usr/bin/env node
import { argv, stderr } from "node:process";

import { runMcpStdioProxy } from "./proxy.js";
import { runDaemon } from "./run-daemon.js";

async function main(): Promise<void> {
	const [command = "mcp"] = argv.slice(2);

	if (command === "daemon") {
		await runDaemon();
		return;
	}
	if (command === "mcp") {
		await runMcpStdioProxy();
		return;
	}

	stderr.write("Usage: omo-lsp-daemon [mcp | daemon]\n");
	process.exitCode = 2;
}

main().catch((error: unknown) => {
	stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
