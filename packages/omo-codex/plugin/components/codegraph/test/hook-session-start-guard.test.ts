import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
	executeCodegraphSessionStartHook,
	type CodegraphSessionStartOutcome,
	type WorkerSpawnInvocation,
} from "../src/hook.ts";
import { recordSessionStartFailure } from "../src/session-start-cooldown.ts";

const pluginRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function createAllowedWorkspace(prefix: string): string {
	return mkdtempSync(join(pluginRoot, `.tmp-${prefix}-`));
}

describe("CodeGraph SessionStart spawn guards", () => {
	it("#given an inconclusive probe timeout #when SessionStart runs #then timeout is not treated as uninitialized", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-timeout-home-"));
		const workspace = createAllowedWorkspace("codegraph-timeout-workspace");
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			// when
			const result = await executeCodegraphSessionStartHook({
				ancestorProbe: () => ({ kind: "inconclusive", reason: "status timed out" }),
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				spawnWorker: (invocation) => spawned.push(invocation),
				stdin: Readable.from(["{}"]),
				sweepZombies: () => undefined,
			});

			// then
			expect(result).toEqual({ action: "skipped-inconclusive", exitCode: 0 });
			expect(spawned).toEqual([]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given one hook already owns the project lock #when a second SessionStart runs #then it records skipped-locked without spawning", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-dedup-home-"));
		const workspace = createAllowedWorkspace("codegraph-dedup-workspace");
		const outcomes: CodegraphSessionStartOutcome[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		const options = {
			ancestorProbe: () => ({ kind: "uninitialized" } as const),
			config: { codegraph: { enabled: true }, sources: [], warnings: [] },
			cwd: workspace,
			env: { HOME: homeDir },
			logOutcome: (outcome: CodegraphSessionStartOutcome) => outcomes.push(outcome),
			spawnWorker: (invocation: WorkerSpawnInvocation) => {
				spawned.push(invocation);
			},
			stdin: Readable.from(["{}"]),
			sweepZombies: () => undefined,
		};
		try {
			await executeCodegraphSessionStartHook(options);

			// when
			const second = await executeCodegraphSessionStartHook({ ...options, stdin: Readable.from(["{}"]) });

			// then
			expect(second).toEqual({ action: "skipped-locked", exitCode: 0 });
			expect(spawned).toHaveLength(1);
			expect(outcomes).toContainEqual({ action: "skipped-locked", projectRoot: workspace });
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given a failed worker cooldown #when SessionStart retries before and after expiry #then only the expired retry spawns", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-cooldown-hook-home-"));
		const workspace = createAllowedWorkspace("codegraph-cooldown-hook-workspace");
		const outcomes: CodegraphSessionStartOutcome[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			recordSessionStartFailure({
				action: "failed",
				baseCooldownMs: 60_000,
				homeDir,
				nowMs: 1_000,
				projectRoot: workspace,
			});
			const baseOptions = {
				ancestorProbe: () => ({ kind: "uninitialized" } as const),
				config: { codegraph: { enabled: true, session_start_cooldown_ms: 60_000 }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome: CodegraphSessionStartOutcome) => outcomes.push(outcome),
				spawnWorker: (invocation: WorkerSpawnInvocation) => {
					spawned.push(invocation);
				},
				sweepZombies: () => undefined,
			};

			// when
			const suppressed = await executeCodegraphSessionStartHook({ ...baseOptions, nowMs: 60_999, stdin: Readable.from(["{}"]) });
			const expired = await executeCodegraphSessionStartHook({ ...baseOptions, nowMs: 61_000, stdin: Readable.from(["{}"]) });

			// then
			expect(suppressed).toEqual({ action: "skipped-cooldown", exitCode: 0 });
			expect(expired).toEqual({ action: "spawned", exitCode: 0 });
			expect(spawned).toHaveLength(1);
			expect(outcomes).toContainEqual({
				action: "skipped-cooldown",
				cooldownUntil: 61_000,
				failureCount: 1,
				projectRoot: workspace,
			});
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("#given an ancestor has a CodeGraph database #when SessionStart runs in a nested project #then it records skipped-nested-root", async () => {
		// given
		const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-nested-home-"));
		const ancestorRoot = createAllowedWorkspace("codegraph-nested-ancestor");
		const workspace = join(ancestorRoot, "apps", "server");
		const outcomes: CodegraphSessionStartOutcome[] = [];
		const spawned: WorkerSpawnInvocation[] = [];
		try {
			mkdirSync(join(ancestorRoot, ".codegraph"), { recursive: true });
			mkdirSync(workspace, { recursive: true });
			writeFileSync(join(ancestorRoot, ".codegraph", "codegraph.db"), "fixture");

			// when
			const result = await executeCodegraphSessionStartHook({
				config: { codegraph: { enabled: true }, sources: [], warnings: [] },
				cwd: workspace,
				env: { HOME: homeDir },
				logOutcome: (outcome) => outcomes.push(outcome),
				spawnWorker: (invocation) => spawned.push(invocation),
				stdin: Readable.from(["{}"]),
				sweepZombies: () => undefined,
			});

			// then
			expect(result).toEqual({ action: "skipped-nested-root", exitCode: 0 });
			expect(spawned).toEqual([]);
			expect(outcomes).toContainEqual({ action: "skipped-nested-root", ancestorRoot, projectRoot: workspace });
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
			rmSync(ancestorRoot, { recursive: true, force: true });
		}
	});
});
