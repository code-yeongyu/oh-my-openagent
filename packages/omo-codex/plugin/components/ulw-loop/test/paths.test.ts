// biome-ignore-all format: compact path tests predate this change.
import { join, posix, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import {
	isWithinAttemptDir,
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
		expect(ulwLoopDir("/repo")).toBe(join("/repo", ".omo", "ulw-loop"));
	});

	it("#given a session id #when resolving the loop dir #then scopes artifacts under that session", () => {
		// when/then
		expect(ulwLoopDir("/repo", { sessionId: "sess_abc" })).toBe(join("/repo", ".omo", "ulw-loop", "sess_abc"));
	});
});

describe("ulw-loop*Path helpers", () => {
	it("compose artifact filenames under ulwLoopDir", () => {
		// when/then
		expect(ulwLoopBriefPath("/r")).toBe(join("/r", ".omo", "ulw-loop", "brief.md"));
		expect(ulwLoopGoalsPath("/r")).toBe(join("/r", ".omo", "ulw-loop", "goals.json"));
		expect(ulwLoopLedgerPath("/r")).toBe(join("/r", ".omo", "ulw-loop", "ledger.jsonl"));
	});

	it("#given a session id #when composing artifact filenames #then returns session-scoped paths", () => {
		// when/then
		expect(ulwLoopBriefPath("/r", { sessionId: "session-A" })).toBe(join("/r", ".omo", "ulw-loop", "session-A", "brief.md"));
		expect(ulwLoopGoalsPath("/r", { sessionId: "session-A" })).toBe(join("/r", ".omo", "ulw-loop", "session-A", "goals.json"));
		expect(ulwLoopLedgerPath("/r", { sessionId: "session-A" })).toBe(join("/r", ".omo", "ulw-loop", "session-A", "ledger.jsonl"));
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

describe("isWithinAttemptDir", () => {
	const posixRoot = "/repo/.omo/evidence/ulw/s1/g1/a1";
	const win32Root = "C:\\repo\\.omo\\evidence\\ulw\\s1\\g1\\a1";

	it("#given a child artifact #when checked on posix #then it is contained", () => {
		expect(isWithinAttemptDir(`${posixRoot}/cli-pass.txt`, posixRoot, posix)).toBe(true);
	});

	it("#given a child artifact #when checked with win32 separators #then it is contained", () => {
		expect(isWithinAttemptDir(`${win32Root}\\cli-pass.txt`, win32Root, win32)).toBe(true);
	});

	it("#given the attempt root itself #when checked #then it is contained", () => {
		expect(isWithinAttemptDir(posixRoot, posixRoot, posix)).toBe(true);
		expect(isWithinAttemptDir(win32Root, win32Root, win32)).toBe(true);
	});

	it("#given a sibling dir sharing the prefix #when checked #then it is outside", () => {
		expect(isWithinAttemptDir("/repo/.omo/evidence/ulw/s1/g1/a1x/f.txt", posixRoot, posix)).toBe(false);
		expect(isWithinAttemptDir(`${win32Root}x\\f.txt`, win32Root, win32)).toBe(false);
	});

	it("#given a prior-attempt artifact #when checked #then it is outside", () => {
		expect(isWithinAttemptDir("/repo/.omo/evidence/ulw/s1/g1/a0/f.txt", posixRoot, posix)).toBe(false);
		expect(isWithinAttemptDir("C:\\repo\\.omo\\evidence\\ulw\\s1\\g1\\a0\\f.txt", win32Root, win32)).toBe(false);
	});

	it("#given a different-drive path #when checked on win32 #then it is outside", () => {
		expect(isWithinAttemptDir("D:\\elsewhere\\f.txt", win32Root, win32)).toBe(false);
	});
});
