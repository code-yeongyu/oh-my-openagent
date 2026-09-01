import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CodegraphSessionStartOutcome } from "../src/hook.ts";
import { runCodegraphSessionStartWorker } from "../src/hook.ts";
import { readSessionStartCooldown } from "../src/session-start-cooldown.ts";

describe("CodeGraph SessionStart worker cooldown", () => {
	it("#given codegraph init times out #when the worker finishes #then it records a failed outcome and cooldown", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-timeout-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-timeout-home-"));
		const outcomes: CodegraphSessionStartOutcome[] = [];
		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true, session_start_cooldown_ms: 60_000 }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				nodeVersion: "22.14.0",
				nowMs: 1_000,
				projectProbe: () => ({ kind: "uninitialized" }),
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
					runCommand: () => Promise.resolve({ exitCode: 1, stdout: "", timedOut: true }),
				},
			});
			const cooldown = readSessionStartCooldown({
				baseCooldownMs: 60_000,
				homeDir,
				nowMs: 2_000,
				projectRoot: workspace,
			});

			// then
			expect(result).toEqual({ action: "failed" });
			expect(outcomes).toEqual([{
				action: "failed",
				error: "codegraph init timed out",
				exitCode: 1,
				projectRoot: workspace,
				source: "path",
				timedOut: true,
			}]);
			expect(cooldown).toEqual({ cooldownUntil: 61_000, failureCount: 1, kind: "active" });
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given codegraph init exits zero without an exact database #when the worker verifies the result #then it records a failure cooldown", async () => {
		// given
		const workspace = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-no-db-"));
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-no-db-home-"));
		const outcomes: CodegraphSessionStartOutcome[] = [];
		try {
			// when
			const result = await runCodegraphSessionStartWorker({
				config: { codegraph: { enabled: true, session_start_cooldown_ms: 60_000 }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				nodeVersion: "22.14.0",
				nowMs: 1_000,
				projectProbe: () => ({ kind: "uninitialized" }),
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
					runCommand: () => Promise.resolve({ exitCode: 0, stdout: "", timedOut: false }),
				},
			});
			const cooldown = readSessionStartCooldown({
				baseCooldownMs: 60_000,
				homeDir,
				nowMs: 2_000,
				projectRoot: workspace,
			});

			// then
			expect(result).toEqual({ action: "failed" });
			expect(outcomes).toEqual([{
				action: "failed",
				error: "codegraph init completed without creating an exact project database",
				exitCode: 0,
				projectRoot: workspace,
				source: "path",
				timedOut: false,
			}]);
			expect(cooldown).toEqual({ cooldownUntil: 61_000, failureCount: 1, kind: "active" });
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});
