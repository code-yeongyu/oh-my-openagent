import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe provisioning", () => {
	it("#given CodeGraph is unresolved and daemon is off by default #when serving MCP #then provisions CodeGraph before spawning with CODEGRAPH_NO_DAEMON=1", async () => {
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
			config: { codegraph: { enabled: true }, sources: [], warnings: [] },
			env: { PATH: "/bin" },
			homeDir: "/tmp/home",
			nodeVersion: "22.14.0",
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			ensureProvisioned: (options) =>
				Promise.resolve({
					binPath: join(options.installDir ?? "/tmp/home/.omo/codegraph", "bin", "codegraph"),
					provisioned: true,
				}),
			runProcess: (command, args, options) => {
				calls.push({ args, command, env: options.env });
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(calls).toEqual([
			{
				args: ["serve", "--mcp"],
				command: binPath,
				env: {
					CODEGRAPH_INSTALL_DIR: join("/tmp/home", ".omo", "codegraph"),
					CODEGRAPH_NO_DAEMON: "1",
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
					PATH: "/bin",
				},
			},
		]);
	});

	it("#given CodeGraph is unresolved and codegraph.daemon=true #when serving MCP #then provisions CodeGraph and omits CODEGRAPH_NO_DAEMON so the daemon may run", async () => {
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
			config: { codegraph: { daemon: true, enabled: true }, sources: [], warnings: [] },
			env: { PATH: "/bin" },
			homeDir: "/tmp/home",
			nodeVersion: "22.14.0",
			resolve: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
			ensureProvisioned: (options) =>
				Promise.resolve({
					binPath: join(options.installDir ?? "/tmp/home/.omo/codegraph", "bin", "codegraph"),
					provisioned: true,
				}),
			runProcess: (command, args, options) => {
				calls.push({ args, command, env: options.env });
				return Promise.resolve(0);
			},
			stderr: { write: (chunk: string) => stderr.push(chunk) },
		});

		// then
		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(calls).toEqual([
			{
				args: ["serve", "--mcp"],
				command: binPath,
				env: {
					CODEGRAPH_INSTALL_DIR: join("/tmp/home", ".omo", "codegraph"),
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
					PATH: "/bin",
				},
			},
		]);
		expect(calls[0]?.env["CODEGRAPH_NO_DAEMON"]).toBeUndefined();
	});
});
