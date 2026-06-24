import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphSessionStartWorker } from "../src/hook.ts";
import { runCodegraphServe } from "../src/serve.ts";

describe("CodeGraph provisioned launcher Node guard", () => {
	it("#given provisioned CodeGraph binary #when serve runs under unsupported local Node #then it trusts the launcher", async () => {
		// given
		const commandPath = "/home/test/.omo/codegraph/bin/codegraph";
		const spawned: Array<{ readonly args: readonly string[]; readonly command: string }> = [];

		// when
		const exitCode = await runCodegraphServe({
			env: {},
			nodeVersion: "26.3.0",
			buildEnv: () => ({}),
			resolve: () => ({ argsPrefix: [], command: commandPath, exists: true, source: "provisioned" }),
			runProcess: (command, args) => {
				spawned.push({ args, command });
				return Promise.resolve(0);
			},
			stderr: { write: () => undefined },
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
						return {
							argsPrefix: [],
							command: provisioned ?? "missing-codegraph",
							exists: provisioned !== null,
							source: provisioned === null ? "path" : "provisioned",
						};
					},
					runCommand: (_projectRoot, command, args) => {
						calls.push({ args, command });
						return Promise.resolve({ exitCode: 0, stdout: calls.length === 1 ? '{"initialized":false}' : "", timedOut: false });
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
