import { describe, expect, it } from "vitest";

import { createStdioLazyMcpBackend } from "../src/lazy-mcp-stdio-backend.js";

describe("stdio lazy MCP backend", () => {
	it("#given backend stdio stays open after parent exit #when stopped #then stop resolves on process exit", async () => {
		// given
		const backend = createStdioLazyMcpBackend({
			command: process.execPath,
			args: ["-e", delayedStdioCloseScript()],
		});
		const connection = await backend.start();

		// when
		const result = await Promise.race([connection.stop().then(() => "stopped"), failAfter(300)]);

		// then
		expect(result).toBe("stopped");
	});

	it("#given backend ignores SIGTERM #when stopped #then stop escalates and resolves", async () => {
		// given
		const backend = createStdioLazyMcpBackend({
			command: process.execPath,
			args: ["-e", ignoreSigtermScript()],
		});
		const connection = await backend.start();

		// when
		const result = await Promise.race([connection.stop().then(() => "stopped"), failAfter(1_500)]);

		// then
		expect(result).toBe("stopped");
	});
});

function delayedStdioCloseScript(): string {
	return [
		'const { spawn } = require("node:child_process");',
		'const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 1500); setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"] });',
		'process.on("SIGTERM", () => process.exit(0));',
		"setInterval(() => {}, 1000);",
	].join("");
}

function ignoreSigtermScript(): string {
	return ['process.on("SIGTERM", () => {});', "setInterval(() => {}, 1000);"].join("");
}

function failAfter(delayMs: number): Promise<string> {
	return new Promise((resolve) => {
		setTimeout(() => resolve("timeout"), delayMs);
	});
}
