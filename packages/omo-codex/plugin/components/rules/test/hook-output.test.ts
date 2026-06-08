import { describe, expect, it } from "vitest";

import { formatAdditionalContextOutput } from "../src/hook-output.js";

describe("formatAdditionalContextOutput", () => {
	it("#given context with outer whitespace and CRLF #when serializing hook JSON #then additional context is newline-normalized", () => {
		// given
		const context = "\r\n\r\nFirst line\r\nSecond line\rThird line\r\n";

		// when
		const output = formatAdditionalContextOutput("PostToolUse", context);
		const parsed: unknown = JSON.parse(output);

		// then
		expect(readAdditionalContext(parsed)).toBe("First line\nSecond line\nThird line");
		expect(output.endsWith("\n")).toBe(true);
	});

	it("#given blank context #when serializing hook JSON #then it emits no hook output", () => {
		// given
		const context = "\r\n \n";

		// when
		const output = formatAdditionalContextOutput("SessionStart", context);

		// then
		expect(output).toBe("");
	});

	it("#given oversized context #when serializing hook JSON #then it keeps additional context under the safety cap", () => {
		// given
		const context = `first\n${"x".repeat(50_000)}\nlast`;

		// when
		const output = formatAdditionalContextOutput("SessionStart", context);
		const parsed: unknown = JSON.parse(output);
		const additionalContext = readAdditionalContext(parsed);

		// then
		expect(additionalContext.length).toBeLessThanOrEqual(32_000);
		expect(additionalContext).toContain("first");
		expect(additionalContext).not.toContain("last");
		expect(additionalContext).toContain("[Truncated hook additional context to 32000 chars");
	});
});

function readAdditionalContext(value: unknown): string {
	if (!isRecord(value)) throw new TypeError("Expected hook output object");
	const hookSpecificOutput = value["hookSpecificOutput"];
	if (!isRecord(hookSpecificOutput)) throw new TypeError("Expected hookSpecificOutput object");
	const additionalContext = hookSpecificOutput["additionalContext"];
	if (typeof additionalContext !== "string") throw new TypeError("Expected additionalContext string");
	return additionalContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
