import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { resolveServeProcessInvocation, runCodegraphServe } from "../src/serve.ts";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runCodegraphServe", () => {
	it("#given CodeGraph resolves #when serving MCP #then execs codegraph serve --mcp with bridged stdio and telemetry disabled", async () => {
		// given
		const runCwd = componentRoot;
		const calls: Array<{
			readonly args: readonly string[];
			readonly command: string;
			readonly cwd: string;
			readonly env: Record<string, string | undefined>;
			readonly stdio: "pipe";
		}> = [];

		// when
		const exitCode = await runCodegraphServe({
			cwd: runCwd,
			env: { CUSTOM: "drop", HOME: "/tmp/home", OPENAI_API_KEY: "sk-test-secret" },
			nodeVersion: "22.14.0",
			homeDir: "/tmp/home",
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			runProcess: (
				command: string,
				args: readonly string[],
				options: { readonly cwd: string; readonly env: Record<string, string | undefined>; readonly stdio: "pipe" },
			) => {
				calls.push({ args, command, cwd: options.cwd, env: options.env, stdio: options.stdio });
				return Promise.resolve(7);
			},
			stderr: { write: () => undefined },
		});

		// then
		expect(exitCode).toBe(7);
		expect(calls).toEqual([
			{
				args: ["shim.js", "serve", "--mcp"],
				command: "node",
				cwd: resolve(runCwd),
				env: {
					CODEGRAPH_INSTALL_DIR: join("/tmp/home", ".omo", "codegraph"),
					CODEGRAPH_NO_DAEMON: "1",
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
					HOME: "/tmp/home",
				},
				stdio: "pipe",
			},
		]);
		expect(calls[0]?.env["CUSTOM"]).toBeUndefined();
		expect(calls[0]?.env["OPENAI_API_KEY"]).toBeUndefined();
	});

	it("#given codegraph.daemon=true #when serving MCP #then CODEGRAPH_NO_DAEMON is omitted so the daemon may run", async () => {
		// given
		const runCwd = componentRoot;
		const calls: Array<{
			readonly args: readonly string[];
			readonly command: string;
			readonly cwd: string;
			readonly env: Record<string, string | undefined>;
			readonly stdio: "pipe";
		}> = [];

		// when
		const exitCode = await runCodegraphServe({
			config: { codegraph: { daemon: true, enabled: true }, sources: [], warnings: [] },
			cwd: runCwd,
			env: { CUSTOM: "drop", HOME: "/tmp/home", OPENAI_API_KEY: "sk-test-secret" },
			nodeVersion: "22.14.0",
			homeDir: "/tmp/home",
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			runProcess: (
				command: string,
				args: readonly string[],
				options: { readonly cwd: string; readonly env: Record<string, string | undefined>; readonly stdio: "pipe" },
			) => {
				calls.push({ args, command, cwd: options.cwd, env: options.env, stdio: options.stdio });
				return Promise.resolve(7);
			},
			stderr: { write: () => undefined },
		});

		// then
		expect(exitCode).toBe(7);
		expect(calls).toEqual([
			{
				args: ["shim.js", "serve", "--mcp"],
				command: "node",
				cwd: resolve(runCwd),
				env: {
					CODEGRAPH_INSTALL_DIR: join("/tmp/home", ".omo", "codegraph"),
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
					HOME: "/tmp/home",
				},
				stdio: "pipe",
			},
		]);
		expect(calls[0]?.env["CODEGRAPH_NO_DAEMON"]).toBeUndefined();
		expect(calls[0]?.env["CUSTOM"]).toBeUndefined();
		expect(calls[0]?.env["OPENAI_API_KEY"]).toBeUndefined();
	});

	it("#given an unsupported local Node but the unsafe override is set #when serving MCP #then it still spawns codegraph", async () => {
		// given
		const spawned: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			env: { CODEGRAPH_ALLOW_UNSAFE_NODE: "1" },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			runProcess: (command: string) => {
				spawned.push(command);
				return Promise.resolve(0);
			},
			stderr: { write: () => undefined },
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
			env: { CODEGRAPH_NODE_BIN: nodeBin },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: ["codegraph.js"], command: nodeBin, exists: true, source: "bundled" }),
			runProcess: (command: string, args: readonly string[]) => {
				spawned.push({ args, command });
				return Promise.resolve(0);
			},
			stderr: { write: () => undefined },
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
			env: { OMO_CODEGRAPH_BIN: commandPath },
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			commandExists: (candidate) => candidate === commandPath,
			resolve: () => ({ argsPrefix: [], command: commandPath, exists: true, source: "env" }),
			runProcess: (command: string, args: readonly string[]) => {
				spawned.push({ args, command });
				return Promise.resolve(0);
			},
			stderr: { write: () => undefined },
		});

		// then
		expect(exitCode).toBe(0);
		expect(spawned).toEqual([{ args: ["serve", "--mcp"], command: commandPath }]);
	});

	it("#given Windows Codex SOT install_dir has codegraph.cmd and daemon is off by default #when serving MCP #then it resolves there, exports CODEGRAPH_INSTALL_DIR, and pins CODEGRAPH_NO_DAEMON=1", async () => {
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
					config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
					env: { HOME: "/tmp/home" },
					nodeVersion: "22.14.0",
					homeDir: "/tmp/home",
					resolve: (options) => {
						const provisioned = options.provisioned?.();
						return { argsPrefix: [], command: provisioned ?? "missing", exists: provisioned !== null && provisioned !== undefined, source: "provisioned" };
					},
					runProcess: (command, args, options) => {
						calls.push({ args, command, env: options.env });
						return Promise.resolve(0);
					},
					stderr: { write: () => undefined },
				});

				// then
				expect(exitCode).toBe(0);
				expect(calls).toEqual([
					{
						args: ["serve", "--mcp"],
						command: binPath,
						env: {
							CODEGRAPH_INSTALL_DIR: installDir,
							CODEGRAPH_NO_DAEMON: "1",
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

	it("#given Windows Codex SOT install_dir with codegraph.daemon=true #when serving MCP #then CODEGRAPH_NO_DAEMON is omitted so the daemon may run", async () => {
		await withProcessPlatform("win32", async () => {
			// given
			const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-serve-install-dir-daemon-"));
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
					config: { codegraph: { daemon: true, enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
					env: { HOME: "/tmp/home" },
					nodeVersion: "22.14.0",
					homeDir: "/tmp/home",
					resolve: (options) => {
						const provisioned = options.provisioned?.();
						return { argsPrefix: [], command: provisioned ?? "missing", exists: provisioned !== null && provisioned !== undefined, source: "provisioned" };
					},
					runProcess: (command, args, options) => {
						calls.push({ args, command, env: options.env });
						return Promise.resolve(0);
					},
					stderr: { write: () => undefined },
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
				expect(calls[0]?.env["CODEGRAPH_NO_DAEMON"]).toBeUndefined();
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		});
	});

	it("#given project cwd is under a configured excluded root #when serving MCP #then it exposes an unavailable stub without spawning CodeGraph", async () => {
		// given
		const excludedRoot = mkdtempSync(join(componentRoot, ".tmp-codegraph-excluded-"));
		const projectRoot = join(excludedRoot, "repo");
		const stderr: string[] = [];
		const stdout: string[] = [];
		const calls: string[] = [];
		mkdirSync(projectRoot, { recursive: true });

		try {
			// when
			const exitCode = await runCodegraphServe({
				config: { codegraph: { enabled: true, excluded_roots: [excludedRoot] }, sources: [], warnings: [] },
				cwd: projectRoot,
				env: { HOME: "/tmp/home" },
				homeDir: "/tmp/home",
				nodeVersion: "22.14.0",
				resolve: () => ({ argsPrefix: [], command: "/tmp/codegraph", exists: true, source: "path" }),
				runProcess: () => {
					calls.push("spawned");
					return Promise.resolve(0);
				},
				stderr: { write: (chunk) => stderr.push(chunk) },
				stdin: Readable.from([]),
				stdout: new Writable({
					write: (chunk, _encoding, callback) => {
						stdout.push(String(chunk));
						callback();
					},
				}),
			});

			// then
			expect(exitCode).toBe(0);
			expect(calls).toEqual([]);
			expect(stderr.join("")).toContain("CodeGraph MCP skipped: project excluded");
		} finally {
			rmSync(excludedRoot, { recursive: true, force: true });
		}
	});

	it("#given Windows OMO_CODEGRAPH_BIN is a Node script #when resolving serve invocation #then Node executes the script path", () => {
		// given
		const scriptPath = "C:\\Users\\runner\\codegraph-fake.cjs";

		// when
		const invocation = resolveServeProcessInvocation(scriptPath, ["serve", "--mcp"], "win32");

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
		const invocation = resolveServeProcessInvocation(shimPath, ["serve", "--mcp"], "win32");

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
