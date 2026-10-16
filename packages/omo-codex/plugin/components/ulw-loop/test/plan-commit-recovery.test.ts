import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreToolUsePayload } from "../src/codex-hook.js";
import { ulwLoopDir } from "../src/paths.js";
import { commit, materialize, withCommitHooks } from "../src/plan-commit.js";
import { createUlwLoopPlan } from "../src/plan-crud.js";
import {
	planExists,
	readLedger,
	readUlwLoopPlan,
	withMutationLockOptions,
	withUlwLoopMutationLock,
} from "../src/plan-io.js";
import { applySpawnBudgetGuards } from "../src/spawn-guard.js";
import { runStopResumeHook } from "../src/stop-resume-hook.js";
import { childWriter, cleanupWriters } from "./fixtures/commit-child.js";
import { leaseClock } from "./fixtures/lease-clock.js";

let root: string;
let dir: string;
const scope = { sessionId: "commit-log" };
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ulw-recovery-"));
	dir = ulwLoopDir(root, scope);
});
afterEach(async () => {
	await cleanupWriters();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});
function signal() {
	let resolve: () => void = () => {
		throw new Error("signal not initialized");
	};
	const promise = new Promise<void>((done, reject) => {
		const timeout = setTimeout(() => reject(new Error("signal timed out")), 5_000);
		resolve = () => {
			clearTimeout(timeout);
			done();
		};
	});
	return { promise, resolve };
}
function views() {
	return ["goals.json", "ledger.jsonl", "brief.md"].map((name) => readFileSync(join(dir, name), "utf8"));
}
describe("#given crash recovery through public surfaces", () => {
	it("#when (7b) only revision one exists #then both hooks and existence gates use it", async () => {
		const plan = await createUlwLoopPlan(root, { brief: "unfinished" }, scope);
		for (const name of ["goals.json", "ledger.jsonl", "brief.md"]) await rm(join(dir, name));
		expect(readdirSync(join(dir, "revisions"))).toEqual(["00000001.json"]);
		expect(planExists(root, scope)).toBe(true);
		expect((await readUlwLoopPlan(root, scope)).revision).toBe(1);
		const payload = {
			session_id: scope.sessionId,
			turn_id: "turn",
			cwd: root,
			model: "test",
			permission_mode: "default",
		};
		const stop = {
			...payload,
			hook_event_name: "Stop",
			transcript_path: join(root, "transcript"),
			stop_hook_active: false,
		};
		expect(JSON.parse(runStopResumeHook(stop)).decision).toBe("block");
		expect(JSON.parse(readFileSync(join(dir, `auto-resume-${plan.goals[0]?.id}.json`), "utf8")).ledgerLineCount).toBe(
			1,
		);
		vi.stubEnv("OMO_SPAWN_FANOUT_LIMIT", "1");
		vi.stubEnv("PLUGIN_DATA", join(root, "plugin-data"));
		const spawn: PreToolUsePayload = {
			...payload,
			hook_event_name: "PreToolUse",
			transcript_path: null,
			tool_name: "spawn_agent",
			tool_use_id: "tool",
			tool_input: {},
		};
		expect(applySpawnBudgetGuards(spawn)).toBe("");
		expect(JSON.parse(applySpawnBudgetGuards(spawn)).hookSpecificOutput.permissionDecision).toBe("deny");
	});
	it("#when (7c) two materializers overlap #then every public inode is complete even if a view regresses", async () => {
		const plan = await createUlwLoopPlan(root, { brief: "old" }, scope);
		const old = views();
		await withCommitHooks(
			{
				afterCommit: () => {
					throw new Error("crash");
				},
			},
			() =>
				commit(root, scope, {
					plan: { ...plan, brief: "middle\n" },
					entries: [{ at: "middle", kind: "goal_added" }],
				}),
		).catch((error: unknown) => {
			expect(error).toBeInstanceOf(Error);
		});
		const middleViews = [
			`${JSON.stringify(await readUlwLoopPlan(root, scope), null, 2)}\n`,
			`${readLedger(root, scope)
				.map((entry) => JSON.stringify(entry))
				.join("\n")}\n`,
			"middle\n",
		];
		const partial = signal();
		const resume = signal();
		const first = withCommitHooks(
			{
				writeView: async (path, content) => {
					if (path.endsWith("ledger.jsonl")) {
						await writeFile(path, content.slice(0, 5));
						partial.resolve();
						await resume.promise;
					}
					await writeFile(path, content);
				},
			},
			() => materialize(dir),
		);
		await partial.promise;
		expect(readFileSync(join(dir, "ledger.jsonl"), "utf8")).toBe(old[1]);
		const latest = await readUlwLoopPlan(root, scope);
		await commit(root, scope, { plan: { ...latest, brief: "new\n" }, entries: [{ at: "new", kind: "goal_added" }] });
		const newViews = views();
		resume.resolve();
		await first;
		const final = views();
		expect(() => JSON.parse(final[0] ?? "")).not.toThrow();
		for (const line of (final[1] ?? "").trim().split("\n")) expect(() => JSON.parse(line)).not.toThrow();
		for (const [index, content] of final.entries()) expect([middleViews[index], newViews[index]]).toContain(content);
		expect(
			readLedger(root, scope)
				.map((entry) => entry.at)
				.slice(-2),
		).toEqual(["middle", "new"]);
	});
	it("#when (9) a force-recreator loses before its first possible view write #then its successor stays untouched", async () => {
		await createUlwLoopPlan(root, { brief: "old" }, scope);
		let successor: string[] = [];
		let writes = 0;
		const clock = leaseClock();
		await expect(
			withCommitHooks(
				{
					beforeMutation: async () => {
						clock.advance(201);
						const writer = childWriter(root, "force", clock.now());
						expect(await writer.exited).toBe(0);
						successor = views();
					},
					writeView: async (path, content) => {
						writes += 1;
						await writeFile(path, content);
					},
				},
				() =>
					withMutationLockOptions({ clock, leaseMs: 200, heartbeatMs: 0 }, () =>
						createUlwLoopPlan(root, { brief: "A", force: true }, scope),
					),
			),
		).rejects.toMatchObject({ code: "ULW_LOOP_LOCK_LOST" });
		expect(writes).toBe(0);
		expect(views()).toEqual(successor);
		expect(readLedger(root, scope)).toHaveLength(1);
	});
	it("#when a locked ledger-only read follows a crash #then all views are repaired without another revision", async () => {
		const plan = await createUlwLoopPlan(root, { brief: "old" }, scope);
		await expect(
			withCommitHooks(
				{
					afterCommit: () => {
						throw new Error("crash");
					},
				},
				() => commit(root, scope, { plan: { ...plan, brief: "new\n" }, entries: [] }),
			),
		).rejects.toThrow("crash");
		await withUlwLoopMutationLock(root, scope, async () => {
			expect(readLedger(root, scope)).toHaveLength(1);
		});
		expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe("new\n");
		expect(readdirSync(join(dir, "revisions"))).toHaveLength(2);
	});
});
