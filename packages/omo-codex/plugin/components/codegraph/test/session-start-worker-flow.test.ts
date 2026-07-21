import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodegraphCommandInvocation, runCodegraphSessionStartWorker } from "../src/hook.ts";

describe("CodeGraph SessionStart worker flow", () => {
	it("#given Windows install_dir has codegraph.cmd #when worker resolves provisioned CodeGraph #then it uses the cmd shim", async () => {
		await withProcessPlatform("win32", async () => {
			// given
			const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-"));
			const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-home-"));
			const installDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-win32-install-"));
			const binPath = join(installDir, "bin", "codegraph.cmd");
			const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
			const outcomes: unknown[] = [];
			try {
				mkdirSync(join(installDir, "bin"), { recursive: true });
				writeFileSync(binPath, "");

				// when
				const result = await runCodegraphSessionStartWorker({
					config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
					nodeVersion: "22.14.0",
					cwd: workspace,
					env: { HOME: homeDir },
					logOutcome: (outcome) => outcomes.push(outcome),
					deps: {
						ensureGitignored: () => true,
						ensureProvisioned: () => {
							throw new Error("provisioning should not run when install_dir binary exists");
						},
						prepareWorkspace: () => ({
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						}),
						resolveCommand: (options) => {
							const provisioned = options?.provisioned?.() ?? null;
							return { argsPrefix: [], command: provisioned ?? "missing-codegraph", exists: provisioned !== null, source: provisioned === null ? "path" : "provisioned" };
						},
						runCommand: (_projectRoot, command, args, options) => {
							calls.push({ args, command, env: options.env });
							return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":false}' : "", timedOut: false });
						},
					},
				});

				// then
				expect(result).toEqual({ action: "initialized" });
				expect(calls.map((call) => ({ args: [...call.args], command: call.command }))).toEqual([
					{ args: ["status", "--json"], command: binPath },
					{ args: ["init"], command: binPath },
				]);
				expect(calls[0]?.env["CODEGRAPH_INSTALL_DIR"]).toBe(installDir);
				expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "provisioned", timedOut: false }]);
			} finally {
				rmSync(workspace, { recursive: true, force: true });
				rmSync(homeDir, { recursive: true, force: true });
				rmSync(installDir, { recursive: true, force: true });
			}
		});
	});

	it("#given Windows codegraph.cmd #when default worker runner builds invocation #then it runs through cmd.exe", () => {
		// given
		const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cmd";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["status", "--json"], "win32");

		// then
		expect(invocation).toEqual({
			args: ["/d", "/s", "/c", command, "status", "--json"],
			command: "cmd.exe",
		});
	});

	it("#given Windows CodeGraph resolves to a Node script #when default worker runner builds invocation #then Node executes it", () => {
		// given
		const command = "C:\\Users\\test\\.omo\\codegraph\\bin\\codegraph.cjs";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["status", "--json"], "win32");

		// then
		expect(invocation).toEqual({
			args: [command, "status", "--json"],
			command: process.execPath,
		});
	});

	it("#given non-Windows codegraph command #when default worker runner builds invocation #then it executes directly", () => {
		// given
		const command = "/home/test/.omo/codegraph/bin/codegraph";

		// when
		const invocation = resolveCodegraphCommandInvocation(command, ["sync"], "linux");

		// then
		expect(invocation).toEqual({ args: ["sync"], command });
	});

	it("#given resolved CodeGraph status #when worker runs #then it runs status before init or sync", async () => {
		for (const scenario of [
			{ action: "initialized", args: [["status", "--json"], ["init"]], stdout: '{"initialized":false}' },
			{ action: "synced", args: [["status", "--json"], ["sync"]], stdout: '{"initialized":true}' },
		] as const) {
			// given
			const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-status-"));
			const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-status-home-"));
			const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
			const outcomes: unknown[] = [];
			try {
				// when
				const result = await runCodegraphSessionStartWorker({
					config: { codegraph: { enabled: true, install_dir: "/tmp/codegraph-install" }, sources: [], trustedCodegraphInstallDir: "/tmp/codegraph-install", warnings: [] },
					nodeVersion: "22.14.0",
					cwd: workspace,
					env: { HOME: homeDir },
					logOutcome: (outcome) => outcomes.push(outcome),
					deps: {
						ensureGitignored: () => true,
						ensureProvisioned: () => Promise.resolve({ binPath: "/tmp/codegraph", provisioned: true }),
						prepareWorkspace: () => ({
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						}),
						resolveCommand: () => ({ argsPrefix: [], command: "/tmp/codegraph", exists: true, source: "path" }),
						runCommand: (_projectRoot, command, args, options) => {
							calls.push({ args, command, env: options.env });
							return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? scenario.stdout : "", timedOut: false });
						},
					},
				});

				// then
				expect(result).toEqual({ action: scenario.action });
				expect(calls.map((call) => [...call.args])).toEqual(scenario.args.map((args) => [...args]));
				expect(calls[0]?.env["CODEGRAPH_INSTALL_DIR"]).toBe("/tmp/codegraph-install");
				expect(outcomes).toEqual([{ action: scenario.action, exitCode: 0, projectRoot: workspace, source: "path", timedOut: false }]);
			} finally {
				rmSync(workspace, { recursive: true, force: true });
				rmSync(homeDir, { recursive: true, force: true });
			}
		}
	});

	it("#given codegraph.daemon=true #when the indexing worker runs #then its env stays daemon-less with CODEGRAPH_NO_DAEMON=1", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-daemon-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-daemon-home-"));
		const calls: { readonly args: readonly string[]; readonly command: string; readonly env: Record<string, string> }[] = [];
		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { daemon: true, enabled: true, install_dir: "/tmp/codegraph-install" }, sources: [], trustedCodegraphInstallDir: "/tmp/codegraph-install", warnings: [] },
				nodeVersion: "22.14.0",
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: () => undefined,
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: () => Promise.resolve({ binPath: "/tmp/codegraph", provisioned: true }),
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: [], command: "/tmp/codegraph", exists: true, source: "path" }),
					runCommand: (_projectRoot, command, args, options) => {
						calls.push({ args, command, env: options.env });
						return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":true}' : "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "synced" });
			expect(calls.length).toBeGreaterThan(0);
			for (const call of calls) {
				expect(call.env["CODEGRAPH_NO_DAEMON"]).toBe("1");
			}
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given ambient provider tokens #when default worker runner spawns CodeGraph #then child env only gets safe and controlled variables", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-env-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-env-home-"));
		const logPath = join(homeDir, "child-env.jsonl");
		const originalOpenAiKey = process.env["OPENAI_API_KEY"];
		process.env["OPENAI_API_KEY"] = "sk-test-secret";

		try {
			const fakeCodegraphScript = [
				"const fs = require('node:fs');",
				`fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({install:process.env.CODEGRAPH_INSTALL_DIR,openai:process.env.OPENAI_API_KEY}) + '\\n');`,
				"process.stdout.write('{\"initialized\":true}');",
			].join("");

			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: () => undefined,
				nodeVersion: "22.14.0",
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: () => {
						throw new Error("provisioning should not run when command is resolved");
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: ["-e", fakeCodegraphScript], command: process.execPath, exists: true, source: "bundled" }),
				},
			});

			// then
			expect(result).toEqual({ action: "synced" });
			const captured = readFileSync(logPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(captured).toEqual([
				{ install: join(homeDir, ".omo", "codegraph") },
				{ install: join(homeDir, ".omo", "codegraph") },
			]);
		} finally {
			if (originalOpenAiKey === undefined) delete process.env["OPENAI_API_KEY"];
			else process.env["OPENAI_API_KEY"] = originalOpenAiKey;
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
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
