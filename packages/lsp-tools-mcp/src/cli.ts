#!/usr/bin/env node
import { argv, stderr } from "node:process";

import { disposeDefaultLspManager } from "./lsp/manager.js";
import { runMcpStdioServer } from "./mcp.js";

async function main(): Promise<void> {
	const [command = "mcp"] = argv.slice(2);

	try {
		if (command === "mcp") {
			await runMcpStdioServer();
			return;
		}

		stderr.write("Usage: omo-lsp [mcp]\n");
		process.exitCode = 2;
	} finally {
		await disposeDefaultLspManager();
	}
}

main().catch(async (error: unknown) => {
	stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	await disposeDefaultLspManager();
	process.exitCode = 1;
});
