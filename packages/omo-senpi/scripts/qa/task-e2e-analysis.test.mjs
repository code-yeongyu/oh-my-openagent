import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { changedRealPaths, classifyRealSenpiChanges, snapshotDir } from "./task-e2e-analysis.mjs";

describe("snapshotDir", () => {
	test("#given a transient lock directory #when it disappears during traversal #then the snapshot continues", () => {
		// given
		const root = mkdtempSync(join(tmpdir(), "task-e2e-snapshot-"));
		const lockDir = join(root, "hooks-state.json.lock");
		let observedTransientDirectory = false;
		mkdirSync(lockDir);
		writeFileSync(join(root, "settings.json"), JSON.stringify({ theme: "dark" }));

		// when
		const snapshot = snapshotDir(root, {
			readdir(dir, options) {
				if (dir === lockDir) {
					observedTransientDirectory = true;
					rmSync(lockDir, { recursive: true, force: true });
					const error = new Error(`ENOENT: no such file or directory, scandir '${lockDir}'`);
					error.code = "ENOENT";
					throw error;
				}
				return readdirSync(dir, options);
			},
		});

		// then
		expect(observedTransientDirectory).toBe(true);
		expect(snapshot.has("settings.json")).toBe(true);
		expect(snapshot.has("hooks-state.json.lock")).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});
});

describe("changedRealPaths", () => {
	test("#given machine-global append-only logs #when snapshots differ #then they are excluded from QA pollution", () => {
		const before = new Map([
			["senpi-debug.log", "before-debug"],
			["logs/config-reload.log", "before-reload"],
			["logs/fallback.log", "before-fallback"],
			["settings.json", "stable"],
		]);
		const after = new Map([
			["senpi-debug.log", "after-debug"],
			["logs/config-reload.log", "after-reload"],
			["logs/fallback.log", "after-fallback"],
			["settings.json", "stable"],
		]);

		expect(changedRealPaths(before, after)).toEqual([]);
	});

	test("#given settings tips timestamps change #when snapshots compare #then only substantive settings changes count", () => {
		const root = mkdtempSync(join(tmpdir(), "task-e2e-settings-"))
		try {
			const settings = join(root, "settings.json")
			writeFileSync(settings, JSON.stringify({ theme: "dark", tipsHistory: { one: 1 } }))
			const before = snapshotDir(root)
			writeFileSync(settings, JSON.stringify({ theme: "dark", tipsHistory: { one: 2 } }))
			const tipsOnly = snapshotDir(root)
			writeFileSync(settings, JSON.stringify({ theme: "light", tipsHistory: { one: 3 } }))
			const substantive = snapshotDir(root)

			expect(changedRealPaths(before, tipsOnly)).toEqual([])
			expect(changedRealPaths(before, substantive)).toEqual(["settings.json"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	});
});

describe("classifyRealSenpiChanges", () => {
	test("#given mixed live-host mutations #when classified #then unrelated sessions stay separate", () => {
		// #given
		const changedPaths = [
			"sessions/--Users-yeongyu-projects-unrelated--/events.jsonl",
			"sessions/--var-folders-omo-senpi-qa-AbC123-project--/events.jsonl",
			"settings.json",
		];

		// #when
		const result = classifyRealSenpiChanges(changedPaths, [
			"omo-senpi-qa-AbC123",
		]);

		// #then
		expect(result).toEqual({
			qaAttributedPaths: [
				"sessions/--var-folders-omo-senpi-qa-AbC123-project--/events.jsonl",
				"settings.json",
			],
			concurrentSessionPaths: [
				"sessions/--Users-yeongyu-projects-unrelated--/events.jsonl",
			],
		});
	});

	test("#given global agent-dir mutations #when classified #then every path is QA-attributed", () => {
		// #given
		const changedPaths = ["auth.json", "extensions/omo.js"];

		// #when
		const result = classifyRealSenpiChanges(changedPaths, [
			"omo-senpi-qa-AbC123",
		]);

		// #then
		expect(result.qaAttributedPaths).toEqual(changedPaths);
		expect(result.concurrentSessionPaths).toEqual([]);
	});
});
