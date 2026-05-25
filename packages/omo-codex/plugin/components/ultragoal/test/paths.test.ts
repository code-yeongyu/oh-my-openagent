import { describe, expect, it } from "vitest";

import {
	repoRelative,
	ultragoalBriefPath,
	ultragoalDir,
	ultragoalGoalsPath,
	ultragoalLedgerPath,
} from "../src/paths.ts";

describe("ultragoalDir(repo)", () => {
	it("returns repo + '/.omo/ultragoal'", () => {
		// when/then
		expect(ultragoalDir("/repo")).toBe("/repo/.omo/ultragoal");
	});
});

describe("ultragoal*Path helpers", () => {
	it("compose artifact filenames under ultragoalDir", () => {
		// when/then
		expect(ultragoalBriefPath("/r")).toBe("/r/.omo/ultragoal/brief.md");
		expect(ultragoalGoalsPath("/r")).toBe("/r/.omo/ultragoal/goals.json");
		expect(ultragoalLedgerPath("/r")).toBe("/r/.omo/ultragoal/ledger.jsonl");
	});
});

describe("repoRelative", () => {
	it("strips repo prefix when path is inside repo", () => {
		// when/then
		expect(repoRelative("/repo/.omo/ultragoal/goals.json", "/repo")).toBe(".omo/ultragoal/goals.json");
	});

	it("returns absolute when path is outside repo", () => {
		// when/then
		expect(repoRelative("/elsewhere/file", "/repo")).toBe("/elsewhere/file");
	});
});
