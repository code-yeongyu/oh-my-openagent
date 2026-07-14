#!/usr/bin/env node
import { argv, stderr, stdin } from "node:process";

import { runMcpStdioProxy } from "./proxy.js";
import { runDaemon } from "./run-daemon.js";

async function main(): Promise<void> {
	const [command = "mcp"] = argv.slice(2);

	if (command === "daemon") {
		await runDaemon();
		return;
	}
	if (command === "mcp") {
		const controller = new AbortController();
		const abort = (): void => controller.abort();
		stdin.once("end", abort);
		stdin.once("close", abort);
		try {
			await runMcpStdioProxy({ signal: controller.signal });
		} finally {
			stdin.removeListener("end", abort);
			stdin.removeListener("close", abort);
		}
		return;
	}

	stderr.write("Usage: omo-lsp-daemon [mcp | daemon]\n");
	process.exitCode = 2;
}

main().catch((error: unknown) => {
	stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
