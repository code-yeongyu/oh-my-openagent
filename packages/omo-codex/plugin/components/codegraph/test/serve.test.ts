import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import type { CodegraphProjectSynchronizer, CodegraphServerSpawner } from "@oh-my-opencode/codegraph-mcp";
import { resolveCodegraphProcessInvocation, runCodegraphServe } from "../src/serve.ts";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runCodegraphServe", () => {
	it("#given CodeGraph resolves #when serving MCP #then execs codegraph serve --mcp with bridged stdio and telemetry disabled", async () => {
		// given
		const runCwd = componentRoot;
		const calls: Array<{
			readonly argsPrefix: readonly string[];
			readonly commandPath: string;
			readonly cwd: string;
			readonly env: Record<string, string | undefined>;
		}> = [];

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			cwd: runCwd,
			env: { CUSTOM: "keep", HOME: "/tmp/home" },
			nodeVersion: "22.14.0",
			homeDir: "/tmp/home",
			buildEnv: ({ homeDir }) => ({
				CODEGRAPH_INSTALL_DIR: `${homeDir}/.omo/codegraph`,
				CODEGRAPH_NO_DOWNLOAD: "1",
				CODEGRAPH_TELEMETRY: "0",
				DO_NOT_TRACK: "1",
			}),
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			spawnServer: (cwd, command, env) => {
				calls.push({ argsPrefix: command.argsPrefix, commandPath: command.command, cwd, env });
				return exitingServer(7);
			},
			stderr: { write: () => undefined },
			synchronizer: readySynchronizer(),
		});

		// then
		expect(exitCode).toBe(7);
		expect(calls).toEqual([
			{
				argsPrefix: ["shim.js"],
				commandPath: "node",
				cwd: resolve(runCwd),
				env: {
					CODEGRAPH_INSTALL_DIR: "/tmp/home/.omo/codegraph",
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					CUSTOM: "keep",
					DO_NOT_TRACK: "1",
					HOME: "/tmp/home",
				},
			},
		]);
	});

	it("#given env cwd candidates do not exist #when serving MCP #then it falls back to the real wrapper cwd", async () => {
		// given
		const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-cwd-fallback-"));
		const runCwd = join(tempRoot, "project");
		const calls: Array<{ readonly cwd: string }> = [];

		try {
			mkdirSync(runCwd, { recursive: true });

			// when
			const exitCode = await runCodegraphServe({
				...closedMcpStdio(),
				cwd: runCwd,
				env: {
					OMO_CODEGRAPH_PROJECT_CWD: join(tempRoot, "missing-project"),
					OMO_CODEGRAPH_SESSION_START_CWD: join(tempRoot, "missing-session"),
					PWD: join(tempRoot, "missing-pwd"),
				},
				nodeVersion: "22.14.0",
				buildEnv: () => ({}),
				resolve: () => ({ argsPrefix: [], command: "codegraph", exists: true, source: "env" }),
				spawnServer: (cwd) => {
					calls.push({ cwd });
					return exitingServer(0);
				},
				stderr: { write: () => undefined },
				synchronizer: readySynchronizer(),
			});

			// then
			expect(exitCode).toBe(0);
			expect(calls).toEqual([{ cwd: realpathSync(runCwd) }]);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given an unsupported local Node but the unsafe override is set #when serving MCP #then it still spawns codegraph", async () => {
		// given
		const spawned: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			env: { CODEGRAPH_ALLOW_UNSAFE_NODE: "1" },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			spawnServer: (_cwd, command) => {
				spawned.push(command.command);
				return exitingServer(0);
			},
			stderr: { write: () => undefined },
			synchronizer: readySynchronizer(),
		});

		// then
		expect(exitCode).toBe(0);
		expect(spawned).toEqual(["node"]);
	});

	it("#given an unsupported local Node but CODEGRAPH_NODE_BIN resolves a bundled shim with Node 22 #when serving MCP #then it spawns the compatible runtime", async () => {
		// given
		const spawned: Array<{ readonly args: readonly string[]; readonly command: string }> = [];
		const nodeBin = "/opt/node22/bin/node";

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			env: { CODEGRAPH_NODE_BIN: nodeBin },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: ["codegraph.js"], command: nodeBin, exists: true, source: "bundled" }),
			spawnServer: (_cwd, command) => {
				spawned.push({ args: [...command.argsPrefix, "serve", "--mcp"], command: command.command });
				return exitingServer(0);
			},
			stderr: { write: () => undefined },
			synchronizer: readySynchronizer(),
		});

		// then
		expect(exitCode).toBe(0);
		expect(spawned).toEqual([{ args: ["codegraph.js", "serve", "--mcp"], command: nodeBin }]);
	});

	it("#given OMO_CODEGRAPH_BIN points at an explicit command #when local Node is unsupported #then serve trusts the configured command", async () => {
		// given
		const commandPath = "/opt/codegraph-node22/bin/codegraph";
		const spawned: Array<{ readonly args: readonly string[]; readonly command: string }> = [];

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			env: { OMO_CODEGRAPH_BIN: commandPath },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			commandExists: (candidate) => candidate === commandPath,
			resolve: () => ({ argsPrefix: [], command: commandPath, exists: true, source: "env" }),
			spawnServer: (_cwd, command) => {
				spawned.push({ args: [...command.argsPrefix, "serve", "--mcp"], command: command.command });
				return exitingServer(0);
			},
			stderr: { write: () => undefined },
			synchronizer: readySynchronizer(),
		});

		// then
		expect(exitCode).toBe(0);
		expect(spawned).toEqual([{ args: ["serve", "--mcp"], command: commandPath }]);
	});

	it("#given Windows Codex SOT install_dir has codegraph.cmd #when serving MCP #then it resolves there and exports CODEGRAPH_INSTALL_DIR", async () => {
		await withProcessPlatform("win32", async () => {
			// given
			const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-serve-install-dir-"));
			const installDir = join(tempRoot, "custom-codegraph");
			const binPath = join(installDir, "bin", "codegraph.cmd");
			const calls: Array<{
				readonly args: readonly string[];
				readonly command: string;
				readonly env: Record<string, string | undefined>;
			}> = [];

			try {
				mkdirSync(join(installDir, "bin"), { recursive: true });
				writeFileSync(binPath, "");

				// when
				const exitCode = await runCodegraphServe({
					...closedMcpStdio(),
					config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
					env: { HOME: "/tmp/home" },
					nodeVersion: "22.14.0",
					homeDir: "/tmp/home",
					resolve: (options) => {
						const provisioned = options.provisioned?.();
						return { argsPrefix: [], command: provisioned ?? "missing", exists: provisioned !== null && provisioned !== undefined, source: "provisioned" };
					},
					spawnServer: (_cwd, command, env) => {
						calls.push({ args: [...command.argsPrefix, "serve", "--mcp"], command: command.command, env });
						return exitingServer(0);
					},
					stderr: { write: () => undefined },
					synchronizer: readySynchronizer(),
				});

				// then
				expect(exitCode).toBe(0);
				expect(calls).toEqual([
					{
						args: ["serve", "--mcp"],
						command: binPath,
						env: {
							CODEGRAPH_INSTALL_DIR: installDir,
							CODEGRAPH_NO_DOWNLOAD: "1",
							CODEGRAPH_TELEMETRY: "0",
							DO_NOT_TRACK: "1",
							HOME: "/tmp/home",
						},
					},
				]);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		});
	});

	it("#given Windows OMO_CODEGRAPH_BIN is a Node script #when resolving serve invocation #then Node executes the script path", () => {
		// given
		const scriptPath = "C:\\Users\\runner\\codegraph-fake.cjs";

		// when
		const invocation = resolveCodegraphProcessInvocation(scriptPath, ["serve", "--mcp"], "win32");

		// then
		expect(invocation).toEqual({
			args: [scriptPath, "serve", "--mcp"],
			command: process.execPath,
		});
	});

	it("#given Windows CodeGraph resolves to a cmd shim #when resolving serve invocation #then cmd.exe executes the shim", () => {
		// given
		const shimPath = "C:\\Users\\runner\\.omo\\codegraph\\bin\\codegraph.cmd";

		// when
		const invocation = resolveCodegraphProcessInvocation(shimPath, ["serve", "--mcp"], "win32");

		// then
		expect(invocation).toEqual({
			args: ["/d", "/s", "/c", shimPath, "serve", "--mcp"],
			command: "cmd.exe",
		});
	});
});

async function withProcessPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { configurable: true, enumerable: true, value: platform });
	try {
		await run();
	} finally {
		if (descriptor !== undefined) Object.defineProperty(process, "platform", descriptor);
	}
}

function closedMcpStdio(): { readonly stdin: PassThrough; readonly stdout: PassThrough } {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	stdout.resume();
	stdin.end();
	return { stdin, stdout };
}

function exitingServer(exitCode: number): ReturnType<CodegraphServerSpawner> {
	return {
		input: new PassThrough(),
		output: new PassThrough(),
		error: new PassThrough(),
		terminate: () => undefined,
		wait: () => Promise.resolve(exitCode),
	};
}

function readySynchronizer(): CodegraphProjectSynchronizer {
	return {
		initialize: () => Promise.resolve(),
		refresh: () => Promise.resolve(true),
	};
}
