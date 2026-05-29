import { describe, expect, it } from "bun:test";

import {
	CLAUDE_SESSION_PREFIX,
	makeUltragoalScope,
	normalizeClaudeSessionId,
	PREFIX_RE,
	sessionScopeDir,
} from "../src/session-scope.js";

describe("normalizeClaudeSessionId", () => {
	it("applies the claude: prefix to a bare session id", () => {
		expect(normalizeClaudeSessionId("abc-123")).toBe("claude:abc-123");
	});

	it("leaves an already-claude-prefixed id untouched", () => {
		expect(normalizeClaudeSessionId("claude:abc-123")).toBe("claude:abc-123");
	});

	it("leaves a sibling-platform prefix untouched", () => {
		expect(normalizeClaudeSessionId("codex:xyz")).toBe("codex:xyz");
		expect(normalizeClaudeSessionId("opencode:xyz")).toBe("opencode:xyz");
	});

	it("throws on an empty session id", () => {
		expect(() => normalizeClaudeSessionId("   ")).toThrow();
	});
});

describe("sessionScopeDir", () => {
	it("converts the prefix colon to a dash", () => {
		expect(sessionScopeDir("abc-123")).toBe("claude-abc-123");
	});

	it("sanitizes path-hostile characters", () => {
		expect(sessionScopeDir("claude:abc/def")).toBe("claude-abc-def");
	});

	it("is deterministic for the same id", () => {
		expect(sessionScopeDir("s1")).toBe(sessionScopeDir("claude:s1"));
	});
});

describe("makeUltragoalScope", () => {
	it("builds a struct with repoRoot, prefixed sessionId, and scope dir", () => {
		const scope = makeUltragoalScope("/repo", "s1");
		expect(scope.repoRoot).toBe("/repo");
		expect(scope.sessionId).toBe("claude:s1");
		expect(scope.sessionScope).toBe("claude-s1");
	});
});

describe("PREFIX_RE / constants", () => {
	it("recognizes the claude prefix", () => {
		expect(PREFIX_RE.test("claude:x")).toBe(true);
		expect(PREFIX_RE.test("nope:x")).toBe(false);
		expect(CLAUDE_SESSION_PREFIX).toBe("claude:");
	});
});
