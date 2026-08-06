import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { callToolViaDaemon, currentRequestContext } from "../src/daemon-client.js";
import { type DaemonServerHandle, startDaemonServer } from "../src/daemon-server.js";
import type { DaemonPaths } from "../src/paths.js";
import { daemonTestPaths } from "./daemon-path-fixture.js";

const tempDirectories: string[] = [];
const servers: DaemonServerHandle[] = [];

afterEach(async () => {
	for (const server of servers.splice(0)) await server.close();
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempPaths(): DaemonPaths {
	const dir = mkdtempSync(join(tmpdir(), "lsp-daemon-rt-"));
	tempDirectories.push(dir);
	return daemonTestPaths(dir);
}

const noSpawn = (): Promise<void> => Promise.resolve();

function defaultContext() {
	return currentRequestContext();
}

function firstBuiltinServerId(statusText: string): string {
	for (const line of statusText.split("\n")) {
		const match = /^- (\S+): \w+; source=builtin;/.exec(line);
		if (match?.[1]) return match[1];
	}
	throw new Error(`no builtin server found in status output:\n${statusText}`);
}

describe("daemon roundtrip", () => {
	it("#given a running daemon #when status tool is called #then returns content over the socket", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		const result = await callToolViaDaemon("status", {}, { paths, ensure: noSpawn, context: defaultContext() });

		expect(result.content[0]?.type).toBe("text");
		expect(result.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given a running daemon #when two calls race #then both receive responses", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		const [a, b] = await Promise.all([
			callToolViaDaemon("status", {}, { paths, ensure: noSpawn, context: defaultContext() }),
			callToolViaDaemon("status", {}, { paths, ensure: noSpawn, context: defaultContext() }),
		]);

		expect(a.content[0]?.text).toContain("Configured LSP servers");
		expect(b.content[0]?.text).toContain("Configured LSP servers");
	});

	it("#given the daemon is unreachable #when a tool is called #then it returns a structured error without running locally", async () => {
		const paths = tempPaths();
		const failingEnsure = (): Promise<void> => Promise.reject(new Error("spawn disabled in test"));

		const result = await callToolViaDaemon("status", {}, { paths, ensure: failingEnsure, context: defaultContext() });

		expect(result.isError).toBe(true);
		const message = result.content[0]?.text ?? "";
		expect(message).toContain("LSP daemon unreachable");
		expect(message).toContain(paths.socket);
		expect(message).toContain(paths.log);
		expect(message).not.toContain("Configured LSP servers");
	});

	it("#given project config env in the request context #when a tool runs on the daemon #then config-loader honors it per-request", async () => {
		const paths = tempPaths();
		const server = await startDaemonServer(paths, { onIdleShutdown: () => {} });
		servers.push(server);

		const baseline = await callToolViaDaemon("status", {}, { paths, ensure: noSpawn, context: defaultContext() });
		const builtinId = firstBuiltinServerId(baseline.content[0]?.text ?? "");
		const projectRoot = tempPaths().dir;
		mkdirSync(projectRoot, { recursive: true });
		const projectDir = realpathSync(projectRoot);
		const configPath = join(projectDir, "lsp.json");
		writeFileSync(configPath, JSON.stringify({ lsp: { [builtinId]: { disabled: true } } }));

		const scoped = await callToolViaDaemon(
			"status",
			{},
			{
				paths,
				ensure: noSpawn,
				context: {
					cwd: projectDir,
					projectConfigPaths: [configPath],
					userConfigPath: join(projectDir, "user-lsp.json"),
					installDecisionsPath: join(projectDir, "lsp-install-decisions.json"),
					capabilities: { installDecisionTool: true },
				},
			},
		);

		const scopedText = scoped.content[0]?.text ?? "";
		expect(scopedText).toContain(`- ${builtinId}: disabled`);
		const unscoped = await callToolViaDaemon("status", {}, { paths, ensure: noSpawn, context: defaultContext() });
		expect(unscoped.content[0]?.text ?? "").toContain(`- ${builtinId}: `);
		expect(unscoped.content[0]?.text ?? "").not.toContain(`- ${builtinId}: disabled`);
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
