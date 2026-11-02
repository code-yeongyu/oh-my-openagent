import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ulwLoopDir } from "../src/paths.js";
import { createUlwLoopPlan } from "../src/plan-crud.js";
import { readNewestRecord, readRecords, reconcilePlan } from "../src/plan-log.js";
import type { UlwLoopPlan } from "../src/types.js";

let root: string;
let dir: string;
let base: UlwLoopPlan;
const scope = { sessionId: "newest-record" };
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ulw-newest-"));
	dir = ulwLoopDir(root, scope);
	base = await createUlwLoopPlan(root, { brief: "initial" }, scope);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
// The names are deliberately mixed-width: lexicographically "000000010.json" sorts BEFORE "00000009.json",
// so only numeric ordering of the parsed revision picks revision 10 as the newest record.
function seedRecord(name: string, revision: number, brief: string): UlwLoopPlan {
	const plan: UlwLoopPlan = { ...base, revision, brief };
	mkdirSync(join(dir, "revisions"), { recursive: true });
	writeFileSync(
		join(dir, "revisions", name),
		`${JSON.stringify({ version: 1, revision, plan, ledger: [{ at: "now", kind: "goal_added", revision, id: `${revision}-0` }] })}\n`,
	);
	return plan;
}

describe("#given a commit log whose newest record is the only one a plan read needs", () => {
	it("#when the newest record is valid #then it wins over older records and a stale goals cache", async () => {
		seedRecord("00000009.json", 9, "nine");
		const newest = seedRecord("000000010.json", 10, "ten");

		expect(base.revision).toBe(1);
		expect(readNewestRecord(dir)?.revision).toBe(10);
		expect(reconcilePlan(dir)).toEqual(newest);
	});
	it("#when the newest record is corrupt #then the newest valid older record wins", () => {
		const older = seedRecord("00000009.json", 9, "nine");
		writeFileSync(join(dir, "revisions", "000000010.json"), "{not json");

		expect(readNewestRecord(dir)?.revision).toBe(9);
		expect(reconcilePlan(dir)).toEqual(older);
	});
	it("#when an OLDER record is unreadable for a non-syntax reason #then the read stops at the newest record", () => {
		const newest = seedRecord("000000010.json", 10, "ten");
		rmSync(join(dir, "revisions", "00000001.json"));
		mkdirSync(join(dir, "revisions", "00000001.json"));

		expect(reconcilePlan(dir)).toEqual(newest);
		expect(readNewestRecord(dir)).toEqual({
			version: 1,
			revision: 10,
			plan: newest,
			ledger: [{ at: "now", kind: "goal_added", revision: 10, id: "10-0" }],
		});
		expect(() => readRecords(dir)).toThrow(/EISDIR/);
	});
	it("#when the NEWEST record is unreadable for a non-syntax reason #then the error propagates", () => {
		seedRecord("00000009.json", 9, "nine");
		mkdirSync(join(dir, "revisions", "000000010.json"));

		expect(() => readNewestRecord(dir)).toThrow(/EISDIR/);
		expect(() => reconcilePlan(dir)).toThrow(/EISDIR/);
	});
});
