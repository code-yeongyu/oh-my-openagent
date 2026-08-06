import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCodegraphSessionStartWorker } from "../src/hook.ts";

describe("CodeGraph SessionStart worker availability", () => {
	it("#given CodeGraph cannot be resolved or provisioned #when worker runs #then it logs a graceful skip", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-home-"));
		const outcomes: unknown[] = [];
		const calls: string[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				cwd: workspace,
				env: { HOME: homeDir },
				nodeVersion: "22.14.0",
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureGitignored: () => {
						calls.push("ensureGitignored");
						return true;
					},
					ensureProvisioned: () => Promise.resolve({ error: "offline", provisioned: false }),
					prepareWorkspace: () => {
						calls.push("prepareWorkspace");
						return {
							dataDir: join(homeDir, ".omo/codegraph/projects/test"),
							dataRoot: join(homeDir, ".omo/codegraph"),
							linked: true,
							mode: "global-linked",
							projectLink: join(workspace, ".codegraph"),
						};
					},
					resolveCommand: () => ({ argsPrefix: [], command: "codegraph", exists: false, source: "path" }),
					runCommand: () => {
						calls.push("runCommand");
						return Promise.resolve({ exitCode: 0, stdout: "", timedOut: false });
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unavailable" });
			expect(calls).toEqual([]);
			expect(outcomes).toEqual([
				{
					action: "skipped-unavailable",
					error: "offline",
					projectRoot: workspace,
					source: "path",
				},
			]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("#given CodeGraph is unavailable and auto provisioning is disabled #when worker runs #then it leaves the project untouched", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-unavailable-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-unavailable-home-"));
		const outcomes: unknown[] = [];

		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { auto_provision: false, enabled: true }, sources: [], warnings: [] },
				nodeVersion: "22.14.0",
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				deps: {
					ensureProvisioned: () => {
						throw new Error("auto provision should not run");
					},
					resolveCommand: () => ({ argsPrefix: [], command: "missing-codegraph", exists: false, source: "path" }),
					runCommand: () => {
						throw new Error("codegraph command should not run");
					},
				},
			});

			// then
			expect(result).toEqual({ action: "skipped-unavailable" });
			expect(existsSync(join(workspace, ".codegraph"))).toBe(false);
			expect(existsSync(join(workspace, ".git", "info", "exclude"))).toBe(false);
			expect(outcomes).toEqual([
				{
					action: "skipped-unavailable",
					error: "codegraph binary unavailable and auto_provision is disabled",
					projectRoot: workspace,
					source: "path",
				},
			]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
