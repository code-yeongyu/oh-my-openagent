import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { CodegraphProjectSynchronizer, CodegraphServerSpawner } from "@oh-my-opencode/codegraph-mcp";
import { runCodegraphSessionStartWorker } from "../src/hook.ts";
import { runCodegraphServe } from "../src/serve.ts";

describe("CodeGraph provisioned launcher Node guard", () => {
	it("#given provisioned CodeGraph binary #when serve runs under unsupported local Node #then it trusts the launcher", async () => {
		// given
		const commandPath = "/home/test/.omo/codegraph/bin/codegraph";
		const spawned: Array<{ readonly args: readonly string[]; readonly command: string }> = [];

		// when
		const exitCode = await runCodegraphServe({
			...closedMcpStdio(),
			env: {},
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: commandPath, exists: true, source: "provisioned" }),
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

	it("#given provisioned CodeGraph exists #when SessionStart worker runs under unsupported local Node #then it bootstraps through the launcher", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node25-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node25-home-"));
		const installDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node25-install-"));
		const binPath = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
		const calls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];
		const outcomes: unknown[] = [];

		try {
			mkdirSync(join(installDir, "bin"), { recursive: true });
			writeFileSync(binPath, "");

			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true, install_dir: installDir }, sources: [], trustedCodegraphInstallDir: installDir, warnings: [] },
				nodeVersion: "26.3.0",
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureProvisioned: () => {
						throw new Error("provisioning should not run when install_dir binary exists");
					},
					resolveCommand: (options) => {
						const provisioned = options?.provisioned?.() ?? null;
						return {
							argsPrefix: [],
							command: provisioned ?? "missing-codegraph",
							exists: provisioned !== null,
							source: provisioned === null ? "path" : "provisioned",
						};
					},
					runCommand: (_projectRoot, command, args) => {
						calls.push({ args: [...command.argsPrefix, ...args], command: command.command });
						return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":false}' : "", stderr: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls).toEqual([
				{ args: ["status", "--json"], command: binPath },
				{ args: ["init"], command: binPath },
			]);
			expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "provisioned", timedOut: false }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(installDir, { recursive: true, force: true });
		}
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
