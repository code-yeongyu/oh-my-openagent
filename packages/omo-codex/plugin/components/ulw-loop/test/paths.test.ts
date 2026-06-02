import { describe, expect, it } from "vitest";

import {
	normalizeUlwLoopSessionId,
	repoRelative,
	ulwLoopBriefPath,
	ulwLoopDir,
	ulwLoopGoalsPath,
	ulwLoopLedgerPath,
} from "../src/paths.ts";

describe("ulwLoopDir(repo)", () => {
	it("returns repo + '/.omo/ulw-loop'", () => {
		// when/then
		expect(ulwLoopDir("/repo")).toBe("/repo/.omo/ulw-loop");
	});

	it("#given a session id #when resolving the loop dir #then scopes artifacts under that session", () => {
		// when/then
		expect(ulwLoopDir("/repo", { sessionId: "sess_abc" })).toBe("/repo/.omo/ulw-loop/sess_abc");
	});
});

describe("ulw-loop*Path helpers", () => {
	it("compose artifact filenames under ulwLoopDir", () => {
		// when/then
		expect(ulwLoopBriefPath("/r")).toBe("/r/.omo/ulw-loop/brief.md");
		expect(ulwLoopGoalsPath("/r")).toBe("/r/.omo/ulw-loop/goals.json");
		expect(ulwLoopLedgerPath("/r")).toBe("/r/.omo/ulw-loop/ledger.jsonl");
	});

	it("#given a session id #when composing artifact filenames #then returns session-scoped paths", () => {
		// when/then
		expect(ulwLoopBriefPath("/r", { sessionId: "session-A" })).toBe("/r/.omo/ulw-loop/session-A/brief.md");
		expect(ulwLoopGoalsPath("/r", { sessionId: "session-A" })).toBe("/r/.omo/ulw-loop/session-A/goals.json");
		expect(ulwLoopLedgerPath("/r", { sessionId: "session-A" })).toBe("/r/.omo/ulw-loop/session-A/ledger.jsonl");
	});
});

describe("normalizeUlwLoopSessionId", () => {
	it("#given traversal-like input #when normalized #then returns a path-safe session segment", () => {
		// when/then
		expect(normalizeUlwLoopSessionId("../bad/id")).toBe("bad-id");
	});

	it("#given blank input #when normalized #then returns null", () => {
		// when/then
		expect(normalizeUlwLoopSessionId("  ")).toBeNull();
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
