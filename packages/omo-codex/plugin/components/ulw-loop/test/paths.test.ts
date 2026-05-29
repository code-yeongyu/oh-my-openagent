import { describe, expect, it } from "vitest";

import { repoRelative, ulwLoopBriefPath, ulwLoopDir, ulwLoopGoalsPath, ulwLoopLedgerPath } from "../src/paths.ts";

describe("ulwLoopDir(repo)", () => {
	it("returns repo + '/.omo/ulw-loop'", () => {
		// when/then
		expect(ulwLoopDir("/repo")).toBe("/repo/.omo/ulw-loop");
	});
});

describe("ulw-loop*Path helpers", () => {
	it("compose artifact filenames under ulwLoopDir", () => {
		// when/then
		expect(ulwLoopBriefPath("/r")).toBe("/r/.omo/ulw-loop/brief.md");
		expect(ulwLoopGoalsPath("/r")).toBe("/r/.omo/ulw-loop/goals.json");
		expect(ulwLoopLedgerPath("/r")).toBe("/r/.omo/ulw-loop/ledger.jsonl");
	});
});

describe("repoRelative", () => {
	it("strips repo prefix when path is inside repo", () => {
		// when/then
		expect(repoRelative("/repo/.omo/ulw-loop/goals.json", "/repo")).toBe(".omo/ulw-loop/goals.json");
	});

	it("returns absolute when path is outside repo", () => {
		// when/then
		expect(repoRelative("/elsewhere/file", "/repo")).toBe("/elsewhere/file");
	});
});
