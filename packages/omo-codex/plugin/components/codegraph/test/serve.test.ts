import { describe, expect, it } from "bun:test";

import { runCodegraphServe } from "../src/serve.ts";

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
});
