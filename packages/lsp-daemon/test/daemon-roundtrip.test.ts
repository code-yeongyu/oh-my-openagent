import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callToolViaDaemon } from "../src/daemon-client.js";
import { type DaemonServerHandle, startDaemonServer } from "../src/daemon-server.js";
import { type DaemonPaths, daemonPaths } from "../src/paths.js";

const tempDirectories: string[] = [];
const servers: DaemonServerHandle[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-rt-"));
	tempDirectories.push(dir);
	return daemonPaths({ CODEX_LSP_DAEMON_DIR: dir }, "test");
}

const noSpawn = (): Promise<void> => Promise.resolve();

describe("daemon roundtrip", () => {
	it("#given a running daemon #when status tool is called #then returns content over the socket", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		const result = await callToolViaDaemon("status", {}, { paths, ensure: noSpawn });

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given a running daemon #when two calls race #then both receive responses", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		const [a, b] = await Promise.all([
			callToolViaDaemon("status", {}, { paths, ensure: noSpawn }),
			callToolViaDaemon("status", {}, { paths, ensure: noSpawn }),
		]);

		expect(a.content[0]?.text).toContain("Configured LSP servers");
		expect(b.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given the daemon is unreachable #when a tool is called #then it falls back to in-process execution", async () => {
		const paths = tempPaths();
		const failingEnsure = (): Promise<void> => Promise.reject(new Error("spawn disabled in test"));

		const result = await callToolViaDaemon("status", {}, { paths, ensure: failingEnsure });

		expect(result.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given a started daemon #when closed #then the socket and pid files are removed", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		if (process.platform !== "win32") {
			expect(existsSync(paths.socket)).toBe(true);
		}
		expect(existsSync(paths.pid)).toBe(true);

		await server.close();

		if (process.platform !== "win32") {
			expect(existsSync(paths.socket)).toBe(false);
		}
		expect(existsSync(paths.pid)).toBe(false);
	});
});
