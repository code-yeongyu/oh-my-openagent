import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphSessionStartWorker } from "../src/hook.ts";

function writeProjectDatabase(workspace: string): void {
	mkdirSync(join(workspace, ".codegraph"), { recursive: true });
	writeFileSync(join(workspace, ".codegraph", "codegraph.db"), "fixture");
}

describe("CodeGraph SessionStart worker Node support", () => {
	it("#given an unsupported local Node and a PATH CodeGraph command with auto provisioning disabled #when worker runs #then it skips without touching the workspace", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-home-"));
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "26.3.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					resolveCommand: () => {
						return { argsPrefix: [], command: "/usr/local/bin/codegraph", exists: true, source: "path" };
					},
					ensureProvisioned: () => {
						throw new Error("ensureProvisioned should not run on unsupported Node");
					},
					prepareWorkspace: () => {
						throw new Error("prepareWorkspace should not run on unsupported Node");
					},
					runCommand: () => {
						throw new Error("runCommand should not run on unsupported Node");
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unsupported-node" });
			expect(existsSync(join(workspace, ".codegraph"))).toBe(false);
			expect(outcomes).toEqual([{ action: "skipped-unsupported-node", projectRoot: workspace }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given an unsupported local Node and a PATH CodeGraph command #when auto provisioning succeeds #then it bootstraps with the provisioned binary", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-provision-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-node-provision-home-"));
		const binPath = join(homeDir, ".omo", "codegraph", "bin", "codegraph");
		const calls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];
		const provisionCalls: Array<{ readonly installDir?: string; readonly lockDir: string; readonly version: "1.5.0" }> = [];
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "26.3.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: (options) => {
						provisionCalls.push(options);
						return Promise.resolve({ binPath, provisioned: true });
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: [], command: "/usr/local/bin/codegraph", exists: true, source: "path" }),
					runCommand: (_projectRoot, command, args) => {
						calls.push({ args, command });
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls).toEqual([{ args: ["init"], command: binPath }]);
			expect(provisionCalls).toEqual([
				{ installDir: join(homeDir, ".omo", "codegraph"), lockDir: join(homeDir, ".omo", "codegraph", ".locks"), version: "1.5.0" },
			]);
			expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "provisioned", timedOut: false }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given bundled CodeGraph and a stale managed install #when the worker runs #then it upgrades and uses the managed runtime", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-managed-upgrade-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-managed-upgrade-home-"));
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
		const commandCalls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "22.14.0",
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: (options) => {
						provisionCalls.push(options);
						return Promise.resolve({ binPath, provisioned: true });
					},
					managedInstallExists: () => true,
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: ["codegraph.js"], command: "/opt/node22/bin/node", exists: true, source: "bundled" }),
					resolveManagedBin: () => null,
					runCommand: (_projectRoot, command, args) => {
						commandCalls.push({ args, command });
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(provisionCalls).toEqual([{ installDir, lockDir: join(installDir, ".locks"), version: "1.5.0" }]);
			expect(commandCalls).toEqual([{ args: ["init"], command: binPath }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given an unsupported local Node but bundled CodeGraph resolves through CODEGRAPH_NODE_BIN #when worker runs #then it bootstraps with the compatible runtime", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-compatible-node-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-compatible-node-home-"));
		const nodeBin = "/opt/node22/bin/node";
		const calls: Array<{ readonly args: readonly string[]; readonly command: string }> = [];
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { CODEGRAPH_NODE_BIN: nodeBin, HOME: homeDir },
				nodeVersion: "26.3.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: () => {
						throw new Error("provisioning should not run when bundled CodeGraph resolved");
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: () => ({ argsPrefix: ["codegraph.js"], command: nodeBin, exists: true, source: "bundled" }),
					runCommand: (_projectRoot, command, args) => {
						calls.push({ args, command });
						writeProjectDatabase(workspace);
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls).toEqual([{ args: ["codegraph.js", "init"], command: nodeBin }]);
			expect(outcomes).toEqual([{ action: "initialized", exitCode: 0, projectRoot: workspace, source: "bundled", timedOut: false }]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
