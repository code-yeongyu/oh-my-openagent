import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { CodegraphProjectSynchronizer, CodegraphServerSpawner } from "@oh-my-opencode/codegraph-mcp";
import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe provisioning", () => {
	it("#given CodeGraph is unresolved #when serving MCP #then provisions CodeGraph before spawning", async () => {
		// given
		const binPath = join("/tmp/home/.omo/codegraph", "bin", "codegraph");
		const calls: Array<{
			readonly args: readonly string[];
			readonly command: string;
			readonly env: Record<string, string | undefined>;
		}> = [];
		const stderr: string[] = [];

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			config: { codegraph: { enabled: true }, sources: [], warnings: [] },
			env: { PATH: "/bin" },
			homeDir: "/tmp/home",
			nodeVersion: "22.14.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			ensureProvisioned: (options) =>
				Promise.resolve({
					binPath: join(options.installDir ?? "/tmp/home/.omo/codegraph", "bin", "codegraph"),
					provisioned: true,
				}),
			spawnServer: (_cwd, command, env) => {
				calls.push({ args: [...command.argsPrefix, "serve", "--mcp"], command: command.command, env });
				return exitingServer(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
			synchronizer: readySynchronizer(),
		});

		// then
		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(calls).toEqual([
			{
				args: ["serve", "--mcp"],
				command: binPath,
				env: { PATH: "/bin" },
			},
		]);
	});
});

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
