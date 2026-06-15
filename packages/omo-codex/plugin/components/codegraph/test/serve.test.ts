import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveServeProcessInvocation, runCodegraphServe } from "../src/serve.ts";

const componentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("runCodegraphServe", () => {
	it("#given CodeGraph is unresolved #when serving MCP #then exits non-zero with a one-line skip hint", async () => {
		// given
		const stderr: string[] = [];
		const spawned: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			env: { PATH: "/bin" },
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			runProcess: (command: string) => {
				spawned.push(command);
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(1);
		expect(spawned).toEqual([]);
		expect(stderr).toEqual([
			"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n",
		]);
	});

	it("#given CodeGraph resolves #when serving MCP #then execs codegraph serve --mcp with inherited stdio and telemetry disabled", async () => {
		// given
		const calls: Array<{
			readonly args: readonly string[];
			readonly command: string;
			readonly env: Record<string, string | undefined>;
			readonly stdio: "inherit";
		}> = [];

		// when
		const exitCode = await runCodegraphServe({
			env: { CUSTOM: "keep", HOME: "/tmp/home" },
			homeDir: "/tmp/home",
			buildEnv: ({ homeDir }) => ({
				CODEGRAPH_INSTALL_DIR: `${homeDir}/.omo/codegraph`,
				CODEGRAPH_NO_DOWNLOAD: "1",
				CODEGRAPH_TELEMETRY: "0",
				DO_NOT_TRACK: "1",
			}),
			resolve: () => ({ argsPrefix: ["shim.js"], command: "node", exists: true, source: "bundled" }),
			runProcess: (
				command: string,
				args: readonly string[],
				options: { readonly env: Record<string, string | undefined>; readonly stdio: "inherit" },
			) => {
				calls.push({ args, command, env: options.env, stdio: options.stdio });
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
				env: {
					CODEGRAPH_INSTALL_DIR: "/tmp/home/.omo/codegraph",
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					CUSTOM: "keep",
					DO_NOT_TRACK: "1",
					HOME: "/tmp/home",
				},
				stdio: "inherit",
			},
		]);
	});

	it("#given OMO_CODEGRAPH_BIN points at a missing path #when serving MCP #then exits before spawn", async () => {
		// given
		const stderr: string[] = [];
		const spawned: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			buildEnv: () => ({}),
			commandExists: () => false,
			resolve: () => ({ argsPrefix: [], command: "/nonexistent", exists: true, source: "env" }),
			runProcess: (command: string) => {
				spawned.push(command);
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(1);
		expect(spawned).toEqual([]);
		expect(stderr).toEqual([
			"CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.\n",
		]);
	});

	it("#given Codex SOT disables CodeGraph #when serving MCP #then exits non-zero with a disabled hint", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-serve-disabled-home-"));
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-serve-disabled-workspace-"));
		const stderr: string[] = [];
		const spawned: string[] = [];
		try {
			mkdirSync(join(homeDir, ".omo"), { recursive: true });
			mkdirSync(join(workspace, ".omo"), { recursive: true });
			writeFileSync(join(homeDir, ".omo", "config.jsonc"), '{ "codegraph": { "enabled": true } }\n');
			writeFileSync(join(workspace, ".omo", "config.jsonc"), '{ "[codex]": { "codegraph": { "enabled": false } } }\n');

			// when
			const exitCode = await runCodegraphServe({
				cwd: workspace,
				env: { HOME: homeDir },
				runProcess: (command: string) => {
					spawned.push(command);
					return Promise.resolve(0);
				},
				stderr: { write: (chunk: string) => stderr.push(chunk) },
			});

			// then
			expect(exitCode).toBe(1);
			expect(spawned).toEqual([]);
			expect(stderr).toEqual([
				"CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.\n",
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
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
					config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], warnings: [] },
					env: { HOME: "/tmp/home" },
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
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		});
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

	it("#given built serve entry #when invoked with a fake CodeGraph binary #then it runs serve mcp exactly once", () => {
		// given
		const tempRoot = createFakeCodegraphRoot();
		try {
			// when
			const result = runBuiltWrapper("dist/serve.js", tempRoot);

			// then
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(readInvocations(tempRoot)).toEqual(['["serve","--mcp"]']);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("#given built cli entry #when invoked with a fake CodeGraph binary #then it runs serve mcp exactly once", () => {
		// given
		const tempRoot = createFakeCodegraphRoot();
		try {
			// when
			const result = runBuiltWrapper("dist/cli.js", tempRoot);

			// then
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
			expect(readInvocations(tempRoot)).toEqual(['["serve","--mcp"]']);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});

function createFakeCodegraphRoot(): string {
	const tempRoot = mkdtempSync(join(tmpdir(), "omo-codegraph-wrapper-"));
	const fakeBinaryPath = join(tempRoot, "codegraph-fake.cjs");
	writeFileSync(
		fakeBinaryPath,
		[
			"#!/usr/bin/env node",
			"const fs = require('node:fs');",
			"fs.appendFileSync(process.env.CODEGRAPH_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
			"",
		].join("\n"),
	);
	chmodSync(fakeBinaryPath, 0o755);
	return tempRoot;
}

function runBuiltWrapper(entryPath: string, tempRoot: string): ReturnType<typeof spawnSync> {
	return spawnSync(process.execPath, [join(componentRoot, entryPath)], {
		cwd: componentRoot,
		encoding: "utf8",
		env: {
			...process.env,
			CODEGRAPH_FAKE_LOG: join(tempRoot, "invocations.log"),
			OMO_CODEGRAPH_BIN: join(tempRoot, "codegraph-fake.cjs"),
		},
		timeout: 5000,
	});
}

function readInvocations(tempRoot: string): readonly string[] {
	return readFileSync(join(tempRoot, "invocations.log"), "utf8").trim().split("\n");
}

async function withProcessPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { configurable: true, enumerable: true, value: platform });
	try {
		await run();
	} finally {
		if (descriptor !== undefined) Object.defineProperty(process, "platform", descriptor);
	}
}
