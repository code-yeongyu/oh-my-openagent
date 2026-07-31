import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphServe } from "../src/serve.ts";

describe("runCodegraphServe provisioning", () => {
	it("#given CodeGraph is unresolved and daemon is omitted #when serving MCP #then provisions CodeGraph with daemon-on", async () => {
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
					CODEGRAPH_NO_DOWNLOAD: "1",
					CODEGRAPH_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
					PATH: "/bin",
				},
			},
		]);
	});

	it("#given a bundled runtime and a stale managed install #when serving MCP #then it upgrades and uses the managed runtime", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-serve-managed-upgrade-"));
		const installDir = join(homeDir, ".omo", "codegraph");
		const binPath = join(installDir, "bin", "codegraph");
		mkdirSync(join(installDir, "bin"), { recursive: true });
		mkdirSync(join(installDir, ".provisioned"), { recursive: true });
		writeFileSync(binPath, "stale codegraph\n");
		writeFileSync(
			join(installDir, ".provisioned", "codegraph-1.4.1.json"),
			`${JSON.stringify({ binPath, version: "1.4.1" })}\n`,
		);
		const provisionCalls: unknown[] = [];
		const processCalls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];

		try {
			// when
			const exitCode = await runCodegraphServe({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				homeDir,
				managedInstallExists: () => true,
				nodeVersion: "22.14.0",
				resolve: () => ({ argsPrefix: ["codegraph.js"], command: "/opt/node22/bin/node", exists: true, source: "bundled" }),
				resolveManagedBin: () => null,
				ensureProvisioned: (options) => {
					provisionCalls.push(options);
					return Promise.resolve({ binPath, provisioned: true });
				},
				runProcess: (command, args) => {
					processCalls.push({ args, command });
					return Promise.resolve(0);
				},
			});

			// then
			expect(exitCode).toBe(0);
			expect(provisionCalls).toEqual([{ installDir, lockDir: join(installDir, ".locks"), version: "1.5.0" }]);
			expect(processCalls).toEqual([{ args: ["serve", "--mcp"], command: binPath }]);
		} finally {
			rmSync(homeDir, { force: true, recursive: true });
		}
	});

	it("#given CodeGraph is unresolved and codegraph.daemon=false #when serving MCP #then provisions CodeGraph with daemon-off", async () => {
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
			config: { codegraph: { daemon: false, enabled: true }, sources: [], warnings: [] },
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
		expect(calls[0]?.env["CODEGRAPH_NO_DAEMON"]).toBe("1");
	});
});
