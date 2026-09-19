import { describe, expect, test } from "bun:test";

import {
	additionalContextOutput,
	blockOutput,
	limitHookText,
	MAX_ADDITIONAL_CONTEXT_CHARS,
	normalizeHookText,
	parseJsonObject,
	systemMessageOutput,
} from "../src/protocol/index.ts";

describe("parseJsonObject", () => {
	test("parses a plain payload", () => {
		expect(parseJsonObject('{"hook_event_name":"Stop"}')).toEqual({ hook_event_name: "Stop" });
	});

	test("returns null for empty, malformed, and non-object payloads", () => {
		expect(parseJsonObject("")).toBeNull();
		expect(parseJsonObject("   ")).toBeNull();
		expect(parseJsonObject("{not json")).toBeNull();
		expect(parseJsonObject("[1,2,3]")).toBeNull();
		expect(parseJsonObject('"text"')).toBeNull();
	});

	test("tolerates surrounding whitespace and newlines", () => {
		expect(parseJsonObject('\n  {"a":1}\n')).toEqual({ a: 1 });
	});
});

describe("additionalContextOutput", () => {
	test("wraps context in hookSpecificOutput for the event", () => {
		const output = additionalContextOutput("UserPromptSubmit", "hello");
		expect(JSON.parse(output)).toEqual({
			hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "hello" },
		});
	});

	test("normalizes CRLF and trims", () => {
		const output = additionalContextOutput("SessionStart", "a\r\nb\r\n");
		expect(JSON.parse(output).hookSpecificOutput.additionalContext).toBe("a\nb");
	});

	test("emits nothing for empty or whitespace-only context", () => {
		expect(additionalContextOutput("SessionStart", "")).toBe("");
		expect(additionalContextOutput("SessionStart", "   \n ")).toBe("");
	});

	test("truncates oversized context and keeps the JSON parseable", () => {
		const huge = "x".repeat(MAX_ADDITIONAL_CONTEXT_CHARS * 2);
		const parsed = JSON.parse(additionalContextOutput("UserPromptSubmit", huge));
		const context: string = parsed.hookSpecificOutput.additionalContext;
		expect(context.length).toBeLessThanOrEqual(MAX_ADDITIONAL_CONTEXT_CHARS);
		expect(context).toContain("[Truncated omo hook output");
	});

	test("ends with exactly one newline", () => {
		const output = additionalContextOutput("Stop", "x");
		expect(output.endsWith("\n")).toBe(true);
		expect(output.endsWith("\n\n")).toBe(false);
	});
});

describe("blockOutput", () => {
	test("uses continue:false + reason, never the deprecated decision field", () => {
		const parsed = JSON.parse(blockOutput("Stop", "keep going"));
		expect(parsed).toEqual({ continue: false, reason: "keep going" });
		expect(parsed.decision).toBeUndefined();
	});

	test("emits nothing without a reason", () => {
		expect(blockOutput("Stop", "  ")).toBe("");
	});
});

describe("systemMessageOutput", () => {
	test("carries a user-visible message", () => {
		expect(JSON.parse(systemMessageOutput("heads up"))).toEqual({ systemMessage: "heads up" });
	});
});

describe("normalizeHookText / limitHookText", () => {
	test("normalizes line endings", () => {
		expect(normalizeHookText("a\r\nb\rc")).toBe("a\nb\nc");
	});

	test("leaves short text untouched", () => {
		expect(limitHookText("short", 100)).toBe("short");
	});

	test("truncates with a marker when the budget can still hold it", () => {
		const limited = limitHookText("y".repeat(500), 120);
		expect(limited.length).toBeLessThanOrEqual(120);
		expect(limited).toContain("[Truncated omo hook output to 120 chars.]");
	});

	test("returns only the marker when the budget is smaller than the marker", () => {
		const limited = limitHookText("y".repeat(50), 5);
		expect(limited.length).toBe(5);
	});
});
