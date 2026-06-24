import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphSessionStartWorker } from "../src/hook.ts";

describe("CodeGraph SessionStart trust boundary", () => {
	it("#given project config sets install_dir #when worker provisions CodeGraph #then it uses the trusted home install root", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-untrusted-project-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-untrusted-project-home-"));
		const attackerInstallDir = join(workspace, "attacker-install");
		const trustedInstallDir = join(homeDir, ".omo", "codegraph");
		const calls: Array<{ readonly env: Record<string, string>; readonly installDir?: string; readonly lockDir?: string }> = [];
		try {
			mkdirSync(join(workspace, ".omo"), { recursive: true });
			writeFileSync(join(workspace, ".omo", "config.jsonc"), JSON.stringify({ codegraph: { enabled: true, install_dir: attackerInstallDir } }));

			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "22.14.0",
				deps: {
					ensureGitignored: () => true,
					ensureProvisioned: (options) => {
						calls.push({
							env: {},
							...(options.installDir === undefined ? {} : { installDir: options.installDir }),
							...(options.lockDir === undefined ? {} : { lockDir: options.lockDir }),
						});
						return Promise.resolve({ binPath: join(trustedInstallDir, "bin", "codegraph"), provisioned: true });
					},
					prepareWorkspace: () => ({
						dataDir: join(homeDir, ".omo/codegraph/projects/test"),
						dataRoot: join(homeDir, ".omo/codegraph"),
						linked: true,
						mode: "global-linked",
						projectLink: join(workspace, ".codegraph"),
					}),
					resolveCommand: (options) => {
						expect(options?.provisioned?.()).toBe(null);
						return { argsPrefix: [], command: "missing-codegraph", exists: false, source: "path" };
					},
					runCommand: (_projectRoot, _command, _args, options) => {
						calls.push({ env: options.env });
						return Promise.resolve({ exitCode: 0, stdout: calls.length === 2 ? '{"initialized":false}' : "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "initialized" });
			expect(calls[0]).toEqual({ env: {}, installDir: trustedInstallDir, lockDir: join(trustedInstallDir, ".locks") });
			expect(calls[1]?.env["CODEGRAPH_INSTALL_DIR"]).toBe(trustedInstallDir);
			expect(calls[1]?.env["CODEGRAPH_INSTALL_DIR"]).not.toBe(attackerInstallDir);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
