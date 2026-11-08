import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	changedSnapshotPaths,
	isolationVerdict,
	scopedIsolationVerdict,
	snapshotDirectory,
} from "./isolation-state.mjs";

const TINY_LIMITS = { maxFiles: 10, maxBytes: 4, maxEntries: 10 };
const protectedState = { snapshot: new Map(), complete: true, errors: [] };
const fdIt = test.skipIf(process.platform !== "linux");

fdIt(
	"#given an incomplete broad real-home observation and complete controlled roots #when verdicts are built #then broad certification fails closed while the scoped lane certifies",
	() => {
		const broadRoot = mkdtempSync(join(tmpdir(), "omo-senpi-broad-home-"));
		const controlledRoot = mkdtempSync(
			join(tmpdir(), "omo-senpi-controlled-home-"),
		);
		try {
			writeFileSync(join(broadRoot, "history.bin"), "historical-data");
			writeFileSync(join(controlledRoot, ".qa-sentinel"), "same");
			const broadBefore = snapshotDirectory(broadRoot, TINY_LIMITS);
			const broadAfter = snapshotDirectory(broadRoot, TINY_LIMITS);
			const controlledBefore = snapshotDirectory(controlledRoot, TINY_LIMITS);
			const controlledAfter = snapshotDirectory(controlledRoot, TINY_LIMITS);

			const broad = isolationVerdict({
				beforeProtected: protectedState,
				afterProtected: protectedState,
				beforeObserved: broadBefore,
				afterObserved: broadAfter,
				observedChangedPaths: [],
			});
			const scoped = scopedIsolationVerdict([
				{ name: "HOME", before: controlledBefore, after: controlledAfter },
			]);

			expect(broadBefore.truncated).toBe(true);
			expect(broad.untouched).toBe(false);
			expect(scoped.certified).toBe(true);
			expect(scoped.complete).toBe(true);
			expect(scoped.changedPaths).toEqual([]);
			expect(scoped.errors).toEqual([]);
		} finally {
			rmSync(broadRoot, { recursive: true, force: true });
			rmSync(controlledRoot, { recursive: true, force: true });
		}
	},
);

fdIt(
	"#given a persistent write in one controlled root #when the scoped verdict is built #then the lane reports the qualified path and fails closed",
	() => {
		const root = mkdtempSync(join(tmpdir(), "omo-senpi-controlled-write-"));
		try {
			const before = snapshotDirectory(root);
			writeFileSync(join(root, "persistent.json"), "written");
			const after = snapshotDirectory(root);

			const verdict = scopedIsolationVerdict([
				{ name: "XDG_DATA_HOME", before, after },
			]);

			expect(changedSnapshotPaths(before.snapshot, after.snapshot)).toEqual([
				"persistent.json",
			]);
			expect(verdict.certified).toBe(false);
			expect(verdict.changedPaths).toEqual(["XDG_DATA_HOME/persistent.json"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);
