#!/usr/bin/env node
import { argv, stderr } from "node:process";

import { disposeDefaultLspManager } from "./lsp/manager.js";
import { runMcpStdioServer } from "./mcp.js";
import { writeMcpLifecycleLog } from "./mcp-lifecycle-log.js";

async function main(): Promise<void> {
	const [command = "mcp"] = argv.slice(2);

	try {
		if (command === "mcp") {
			await runMcpStdioServer(process.stdin, process.stdout, {
				log: writeMcpLifecycleLog,
				onIdleTimeout: async () => {
					await disposeDefaultLspManager();
					process.exit(0);
				},
			});
			return;
		}

		stderr.write("Usage: lsp-tools-mcp [mcp]\n");
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
